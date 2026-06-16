/**
 * DEX price heartbeat.
 *
 * The QUSDC_GAS path prices native QIE gas in QUSDC from the QIEDex
 * WQIE/QUSDC pair reserves, and the paymaster rejects a quote whose pair
 * timestamp is older than its staleness limit (1h).
 *
 * - Testnet: the `TestDexPair` stub only refreshes its timestamp when
 *   `setReserves` is called, so this loop re-writes the current reserves
 *   periodically to simulate an active pool.
 * - Mainnet: the real Uniswap-v2 pair only refreshes `blockTimestampLast`
 *   on swap/mint/burn/sync. A low-traffic pool can therefore go stale, so
 *   this loop calls the permissionless `sync()` periodically to keep the
 *   QUSDC_GAS quote fresh.
 *
 * No-op if no refresh key is configured.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, RPC_URL, CONTRACTS, DEX_REFRESH_PRIVATE_KEY } from "./config.js";

const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "setReserves",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
    ],
    outputs: [],
  },
  { type: "function", name: "sync", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Refresh well inside the paymaster's 1h staleness window.
const HEARTBEAT_INTERVAL_MS = Number(
  process.env["DEX_HEARTBEAT_INTERVAL_MS"] ?? 30 * 60_000,
);

// Explicit gas limit for the refresh writes. The QIE RPC's eth_estimateGas
// returns only the intrinsic cost (~21k) for these calls, so without an
// explicit limit viem submits a tx with no execution gas and `sync()` reverts
// out-of-gas — silently leaving the pair stale. A real sync() uses ~75k; 200k
// is a comfortable ceiling that also covers the testnet setReserves write.
const REFRESH_GAS_LIMIT = BigInt(
  process.env["DEX_REFRESH_GAS_LIMIT"] ?? 200_000,
);

/** Testnet: re-write the stub reserves to bump its timestamp (owner only). */
async function beatTestnet(): Promise<void> {
  const key = DEX_REFRESH_PRIVATE_KEY();
  if (key === undefined || key === "") return;
  const pair = CONTRACTS.dexPair as Address | undefined;
  if (pair === undefined) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicClient = createPublicClient({ transport: http(RPC_URL) }) as any;
  const account = privateKeyToAccount(key as Hex);

  const owner = (await publicClient.readContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: "owner",
  })) as Address;
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.warn(
      `[dex-heartbeat] configured key ${account.address} is not the pair owner ${owner}; skipping`,
    );
    return;
  }

  const [r0, r1] = (await publicClient.readContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: "getReserves",
  })) as [bigint, bigint, number];

  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
  const hash = await walletClient.writeContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: "setReserves",
    args: [r0, r1],
    chain: null,
    gas: REFRESH_GAS_LIMIT,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setReserves reverted (tx ${hash}); testnet quote NOT refreshed`);
  }
  console.log(`[dex-heartbeat] refreshed testnet pair reserves timestamp (tx ${hash})`);
}

/** Mainnet: call the permissionless sync() to refresh blockTimestampLast. */
async function beatMainnet(): Promise<void> {
  const key = DEX_REFRESH_PRIVATE_KEY();
  if (key === undefined || key === "") return;
  const pair = CONTRACTS.dexPair as Address | undefined;
  if (pair === undefined) return;

  const account = privateKeyToAccount(key as Hex);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicClient = createPublicClient({ transport: http(RPC_URL) }) as any;
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
  const hash = await walletClient.writeContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: "sync",
    args: [],
    chain: null,
    gas: REFRESH_GAS_LIMIT,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`sync() reverted (tx ${hash}); QUSDC_GAS quote NOT refreshed`);
  }
  console.log(`[dex-heartbeat] mainnet pair sync() refreshed QUSDC_GAS quote (tx ${hash})`);
}

/** Start the DEX price heartbeat. No-op without a refresh key. */
export function startDexHeartbeat(): void {
  if (DEX_REFRESH_PRIVATE_KEY() === undefined) {
    console.log("[dex-heartbeat] no DEX refresh key configured — QUSDC_GAS quote may go stale");
    return;
  }
  const beat = CHAIN_ID === 1983 ? beatTestnet : beatMainnet;
  const label = CHAIN_ID === 1983 ? "testnet setReserves" : "mainnet sync()";
  console.log(`[dex-heartbeat] starting (${label}) interval ${HEARTBEAT_INTERVAL_MS}ms`);
  void beat().catch((e) => console.error("[dex-heartbeat] error:", e));
  setInterval(() => {
    void beat().catch((e) => console.error("[dex-heartbeat] error:", e));
  }, HEARTBEAT_INTERVAL_MS);
}
