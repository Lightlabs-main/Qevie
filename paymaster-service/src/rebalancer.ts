/**
 * Paymaster rebalancer — closes the QUSDC→QIE loop.
 *
 * The paymaster prices and charges gas in QUSDC (Mode A) while it actually
 * spends native QIE. The collected QUSDC therefore has to be converted back to
 * native QIE or the paymaster slowly bleeds QIE and its signer/deposit run dry
 * (which is exactly what crash-looped the service before). This loop:
 *
 *   1. reads `collectedQUSDC` and the two native-QIE sinks (the EntryPoint
 *      deposit and the service signer EOA),
 *   2. when a sink is below its floor, withdraws a capped batch of collected
 *      QUSDC (owner-only), swaps it for WQIE along the QIEDex pair with a
 *      slippage guard, unwraps WQIE→QIE, and tops the sinks back up.
 *
 * It uses the paymaster OWNER key (the same key the heartbeat uses). It is
 * DRY-RUN by default — it only logs intended actions until REBALANCER_LIVE=true.
 * It never swaps dust, never swaps more than the per-run cap, and only acts when
 * a sink is genuinely below its floor, so an idle/healthy paymaster is a no-op.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  RPC_URL,
  CONTRACTS,
  DEX_REFRESH_PRIVATE_KEY,
  SIGNER_PRIVATE_KEY,
  REBALANCER_ENABLED,
  REBALANCER_LIVE,
  REBALANCER_INTERVAL_MS,
  REBALANCER_SLIPPAGE_BPS,
  REBALANCER_MIN_QUSDC,
  REBALANCER_MAX_QUSDC,
  REBALANCER_EP_FLOOR_WEI,
  REBALANCER_EP_TARGET_WEI,
  REBALANCER_SIGNER_FLOOR_WEI,
  REBALANCER_SIGNER_TARGET_WEI,
} from "./config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = ReturnType<typeof createPublicClient<any, any, any>>;

const PAYMASTER_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "collectedQUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawQUSDC", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "depositToEntryPoint", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

const ENTRYPOINT_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const PAIR_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "amount0Out", type: "uint256" }, { name: "amount1Out", type: "uint256" }, { name: "to", type: "address" }, { name: "data", type: "bytes" }], outputs: [] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const WQIE_ABI = [
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const BPS = 10_000n;

function fmtUnits(v: bigint, decimals: number): string {
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}
const fmtQusdc = (v: bigint): string => fmtUnits(v, 6);
const fmtQie = (v: bigint): string => fmtUnits(v, 18);

/** Uniswap-v2 constant-product output for `amountIn`, assuming a 0.3% fee. */
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function getPublicClient(): AnyPublicClient {
  return createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
}

interface SinkState {
  collectedQUSDC: bigint;
  epDeposit: bigint;
  signerBalance: bigint;
  signer: Address;
}

async function readState(pc: AnyPublicClient, paymaster: Address, signer: Address): Promise<SinkState> {
  const [collectedQUSDC, epDeposit, signerBalance] = await Promise.all([
    pc.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "collectedQUSDC" }) as Promise<bigint>,
    pc.readContract({ address: CONTRACTS.entryPoint, abi: ENTRYPOINT_ABI, functionName: "balanceOf", args: [paymaster] }) as Promise<bigint>,
    pc.getBalance({ address: signer }),
  ]);
  return { collectedQUSDC, epDeposit, signerBalance, signer };
}

/** One rebalance tick. Reads sinks; swaps + tops up only when needed. */
export async function runRebalanceOnce(): Promise<void> {
  const key = DEX_REFRESH_PRIVATE_KEY();
  if (key === undefined || key === "") return;
  const owner = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);

  const wqie = CONTRACTS.wqie as Address | undefined;
  const pair = CONTRACTS.dexPair as Address | undefined;
  if (wqie === undefined || pair === undefined) {
    console.warn("[rebalancer] WQIE / dexPair not configured; skipping");
    return;
  }
  const paymaster = CONTRACTS.paymaster;
  const qusdc = CONTRACTS.qusdc;

  const pc = getPublicClient();

  // Guard: only the paymaster owner can withdraw QUSDC.
  const onChainOwner = (await pc.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "owner" })) as Address;
  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    console.warn(`[rebalancer] configured key ${owner.address} is not the paymaster owner ${onChainOwner}; skipping`);
    return;
  }

  // The native-QIE sink we protect is the service signer EOA (pays for receipt /
  // keeper txs) — distinct from the owner. Falls back to the owner if unset.
  let signerAddr: Address = owner.address;
  try {
    signerAddr = privateKeyToAccount((SIGNER_PRIVATE_KEY().startsWith("0x") ? SIGNER_PRIVATE_KEY() : `0x${SIGNER_PRIVATE_KEY()}`) as Hex).address;
  } catch { /* no signer key — protect the owner EOA instead */ }

  const s = await readState(pc, paymaster, signerAddr);

  const epDeficit = s.epDeposit < REBALANCER_EP_FLOOR_WEI ? REBALANCER_EP_TARGET_WEI - s.epDeposit : 0n;
  const signerDeficit = s.signerBalance < REBALANCER_SIGNER_FLOOR_WEI ? REBALANCER_SIGNER_TARGET_WEI - s.signerBalance : 0n;

  if (epDeficit === 0n && signerDeficit === 0n) {
    // Healthy — nothing to do. (Quiet on the happy path.)
    return;
  }

  console.log(
    `[rebalancer] sinks low — epDeposit=${fmtQie(s.epDeposit)} QIE (deficit ${fmtQie(epDeficit)}), ` +
    `signer ${signerAddr}=${fmtQie(s.signerBalance)} QIE (deficit ${fmtQie(signerDeficit)}), ` +
    `collectedQUSDC=${fmtQusdc(s.collectedQUSDC)}`,
  );

  if (s.collectedQUSDC < REBALANCER_MIN_QUSDC) {
    console.warn(`[rebalancer] not enough collected QUSDC to rebalance (have ${fmtQusdc(s.collectedQUSDC)}, need ≥ ${fmtQusdc(REBALANCER_MIN_QUSDC)}); top up native QIE manually for now`);
    return;
  }

  const batch = s.collectedQUSDC > REBALANCER_MAX_QUSDC ? REBALANCER_MAX_QUSDC : s.collectedQUSDC;

  // Quote WQIE out for `batch` QUSDC in. Pair is WQIE/QUSDC; token0 tells order.
  const token0 = (await pc.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" })) as Address;
  const wqieIsToken0 = token0.toLowerCase() === wqie.toLowerCase();
  const [r0, r1] = (await pc.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" })) as [bigint, bigint, number];
  const reserveWQIE = wqieIsToken0 ? r0 : r1;
  const reserveQUSDC = wqieIsToken0 ? r1 : r0;

  const wqieOut = getAmountOut(batch, reserveQUSDC, reserveWQIE);
  // Request the slippage-reduced amount so the pair's K invariant always holds
  // (a conservative ask never strands the input QUSDC on a revert).
  const minWqieOut = (wqieOut * (BPS - REBALANCER_SLIPPAGE_BPS)) / BPS;
  if (minWqieOut <= 0n) {
    console.warn("[rebalancer] computed zero WQIE out; skipping");
    return;
  }
  // WQIE unwraps 1:1, so the QIE we will realise equals minWqieOut.
  const qieOut = minWqieOut;
  const toSigner = signerDeficit > 0n ? (qieOut < signerDeficit ? qieOut : signerDeficit) : 0n;
  const toEntryPoint = qieOut - toSigner;

  const plan =
    `swap ${fmtQusdc(batch)} QUSDC → ~${fmtQie(qieOut)} QIE (min, ${Number(REBALANCER_SLIPPAGE_BPS) / 100}% slippage); ` +
    `send ${fmtQie(toSigner)} QIE → signer ${signerAddr}; deposit ${fmtQie(toEntryPoint)} QIE → EntryPoint`;

  if (!REBALANCER_LIVE) {
    console.log(`[rebalancer] DRY-RUN (set REBALANCER_LIVE=true to execute): ${plan}`);
    return;
  }

  console.log(`[rebalancer] EXECUTING: ${plan}`);
  const wallet = createWalletClient({ account: owner, transport: http(RPC_URL) });
  // viem's writeContract generics are strict about chain inference; this loop
  // passes fully-formed const ABIs, so a thin untyped wrapper is fine here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = (req: any): Promise<Hex> => wallet.writeContract({ ...req, chain: null });

  // 1. Pull the QUSDC batch out of the paymaster to the owner.
  const t1 = await send({ address: paymaster, abi: PAYMASTER_ABI, functionName: "withdrawQUSDC", args: [owner.address, batch] });
  await pc.waitForTransactionReceipt({ hash: t1 });

  // 2. Transfer QUSDC into the pair, then low-level swap for WQIE to the owner.
  const t2 = await send({ address: qusdc, abi: ERC20_ABI, functionName: "transfer", args: [pair, batch] });
  await pc.waitForTransactionReceipt({ hash: t2 });
  const amount0Out = wqieIsToken0 ? minWqieOut : 0n;
  const amount1Out = wqieIsToken0 ? 0n : minWqieOut;
  const t3 = await send({ address: pair, abi: PAIR_ABI, functionName: "swap", args: [amount0Out, amount1Out, owner.address, "0x"] });
  await pc.waitForTransactionReceipt({ hash: t3 });

  // 3. Unwrap WQIE → native QIE.
  const t4 = await send({ address: wqie, abi: WQIE_ABI, functionName: "withdraw", args: [minWqieOut] });
  await pc.waitForTransactionReceipt({ hash: t4 });

  // 4. Top up the sinks: signer EOA first, the rest into the EntryPoint deposit.
  if (toSigner > 0n) {
    const t5 = await wallet.sendTransaction({ to: signerAddr, value: toSigner, chain: null });
    await pc.waitForTransactionReceipt({ hash: t5 });
  }
  if (toEntryPoint > 0n) {
    const t6 = await send({ address: paymaster, abi: PAYMASTER_ABI, functionName: "depositToEntryPoint", value: toEntryPoint });
    await pc.waitForTransactionReceipt({ hash: t6 });
  }
  console.log(`[rebalancer] done — recycled ${fmtQusdc(batch)} QUSDC into ${fmtQie(qieOut)} QIE`);
}

/** Start the rebalancer loop. No-op when disabled or no owner key is set. */
export function startRebalancer(): void {
  if (!REBALANCER_ENABLED) {
    console.log("[rebalancer] disabled (REBALANCER_ENABLED=false)");
    return;
  }
  if (CHAIN_ID !== 1990) {
    console.log("[rebalancer] mainnet-only; skipping on this chain");
    return;
  }
  if (DEX_REFRESH_PRIVATE_KEY() === undefined) {
    console.log("[rebalancer] no owner key configured (DEX_REFRESH_PRIVATE_KEY); skipping");
    return;
  }
  console.log(`[rebalancer] starting (${REBALANCER_LIVE ? "LIVE" : "DRY-RUN"}) interval ${REBALANCER_INTERVAL_MS}ms`);
  void runRebalanceOnce().catch((e) => console.error("[rebalancer] error:", e));
  setInterval(() => {
    void runRebalanceOnce().catch((e) => console.error("[rebalancer] error:", e));
  }, REBALANCER_INTERVAL_MS);
}
