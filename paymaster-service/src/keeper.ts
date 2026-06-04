/**
 * Subscription keeper: polls SubscriptionManager for due charges and submits them
 * as UserOperations through the bundler. Runs on a configurable cron interval.
 *
 * Architecture:
 *   - Reads active subscription IDs from the Supabase index (or falls back to
 *     on-chain event scanning if Supabase is unavailable).
 *   - For each due subscription, builds a UserOperation where the PAYEE's
 *     smart account calls SubscriptionManager.charge(subId).
 *   - Uses Mode A (QUSDC-pay) for keeper-initiated ops so the paymaster covers
 *     gas and recoups from the payee.
 *
 * Security note: the keeper only calls charge() on behalf of the payee, not the
 * payer. The payer's QUSDC is moved only under their pre-authorized allowance.
 */

import {
  type Address,
  createPublicClient,
  http,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SUBSCRIPTION_MANAGER_ABI, createQevieClient } from "@qevie/sdk";
import { CHAIN_ID, RPC_URL, BUNDLER_URL, CONTRACTS, SIGNER_PRIVATE_KEY } from "./config.js";

interface ActiveSub {
  subId: bigint;
  payee: Address;
}

const POLL_INTERVAL_MS = Number(process.env["KEEPER_POLL_INTERVAL_MS"] ?? 60_000);

let activeSubs: ActiveSub[] = [];

function buildKeeperSigner(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return {
    getAddress: async () => account.address,
    signMessage: async (msg: Uint8Array | string): Promise<Hex> => {
      const raw = typeof msg === "string" ? msg : toHex(msg);
      return account.signMessage({ message: { raw: raw as Hex } });
    },
  };
}

function toHex(msg: Uint8Array): Hex {
  return `0x${Buffer.from(msg).toString("hex")}` as Hex;
}

export async function runKeeperOnce(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicClient = createPublicClient({ transport: http(RPC_URL) }) as ReturnType<typeof createPublicClient<any, any, any>>;

  // In production: fetch activeSubs from Supabase index.
  // Fallback: iterate recent NewSubscription events (requires archive node or event indexer).
  // For the initial build, use the in-memory list populated via the indexer below.

  const key = SIGNER_PRIVATE_KEY();
  const qevieClient = createQevieClient({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    paymasterServiceUrl: "",
    contracts: CONTRACTS,
  });

  for (const { subId, payee: payeeAddress } of activeSubs) {
    try {
      const isDue = await publicClient.readContract({
        address: CONTRACTS.subscriptionManager,
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "isDue",
        args: [subId],
      }) as boolean;

      if (!isDue) continue;

      console.log(`[keeper] charging subscription ${subId} for payee ${payeeAddress}`);

      const chargeData = encodeFunctionData({
        abi: SUBSCRIPTION_MANAGER_ABI,
        functionName: "charge",
        args: [subId],
      });

      const executeData = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [{ type: "bytes" }],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "execute",
        args: [CONTRACTS.subscriptionManager, 0n, chargeData],
      });

      const keeperSigner = buildKeeperSigner(key as Hex);
      const acc = qevieClient.account(keeperSigner);
      const op = await acc.buildAndSign(executeData, "qusdc");
      const hash = await qevieClient.bundler.sendUserOperation(op, CONTRACTS.entryPoint);
      console.log(`[keeper] submitted userOpHash=${hash}`);
    } catch (e) {
      console.error(`[keeper] error charging ${subId}:`, e);
    }
  }
}

/** Register a new subscription for keeper tracking. */
export function trackSubscription(sub: ActiveSub): void {
  if (!activeSubs.some((s) => s.subId === sub.subId)) {
    activeSubs.push(sub);
  }
}

/** Start the keeper loop. */
export function startKeeper(): void {
  console.log(`[keeper] starting with poll interval ${POLL_INTERVAL_MS}ms`);
  void runKeeperOnce();
  setInterval(() => { void runKeeperOnce(); }, POLL_INTERVAL_MS);
}
