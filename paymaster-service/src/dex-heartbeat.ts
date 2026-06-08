/**
 * Testnet DEX price heartbeat.
 *
 * The QUSDC_GAS path prices native QIE gas in QUSDC from the QIEDex
 * WQIE/QUSDC pair reserves, and the paymaster rejects a quote whose pair
 * timestamp is older than its staleness limit (1h). On mainnet a real pool
 * refreshes its timestamp on every swap, so it is rarely stale. The testnet
 * `TestDexPair` stub only refreshes when `setReserves` is called, so without a
 * heartbeat the quote goes stale after an hour and QUSDC_GAS becomes
 * unavailable for everyone.
 *
 * This loop re-writes the current reserves periodically (testnet only) to keep
 * the quote fresh — i.e. it simulates an active pool. It is a no-op on mainnet
 * and a no-op if no owner key is configured.
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
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Refresh well inside the paymaster's 1h staleness window.
const HEARTBEAT_INTERVAL_MS = Number(
  process.env["DEX_HEARTBEAT_INTERVAL_MS"] ?? 30 * 60_000,
);

async function beatOnce(): Promise<void> {
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
  });
  console.log(`[dex-heartbeat] refreshed pair reserves timestamp (tx ${hash})`);
}

/** Start the testnet DEX price heartbeat. No-op on mainnet / without a key. */
export function startDexHeartbeat(): void {
  if (CHAIN_ID !== 1983) return;
  if (DEX_REFRESH_PRIVATE_KEY() === undefined) {
    console.log("[dex-heartbeat] no DEX refresh key configured — QUSDC_GAS quote may go stale on testnet");
    return;
  }
  console.log(`[dex-heartbeat] starting with interval ${HEARTBEAT_INTERVAL_MS}ms`);
  void beatOnce().catch((e) => console.error("[dex-heartbeat] error:", e));
  setInterval(() => {
    void beatOnce().catch((e) => console.error("[dex-heartbeat] error:", e));
  }, HEARTBEAT_INTERVAL_MS);
}
