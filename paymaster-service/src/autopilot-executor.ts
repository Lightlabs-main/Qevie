/**
 * Autopilot executor.
 *
 * Polls the intent store for due payments and executes each one with the
 * policy's server-custodied session key. Every payment is bounded on-chain by
 * the Autopilot policy (per-tx/daily/weekly/total caps, allowed recipients,
 * expiry, guardian revoke) — the executor only proposes; the smart account +
 * AgentPolicyManager enforce.
 *
 * Gas mode follows the policy's preference: sponsored while free ops remain,
 * then QUSDC-pay, then native QIE, or pause if the policy says so.
 */

import {
  type Address,
  type Hex,
  createPublicClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PAYMASTER_ABI,
  createQevieClient,
  hashReceiptMetadata,
  type GasMode,
  type AgentPolicy,
  type AllowlistToken,
  type QevieSigner,
  type UserOpResult,
} from "@qevie/sdk";
import {
  CHAIN_ID,
  RPC_URL,
  BUNDLER_URL,
  CONTRACTS,
  AUTOPILOT_EXECUTOR_ENABLED,
  AUTOPILOT_POLL_INTERVAL_MS,
} from "./config.js";
import { issueAllowlistToken } from "./allowlist.js";
import { issueReceipt } from "./receipts.js";
import { getSessionPrivateKey } from "./session-keys.js";
import {
  type AutopilotIntent,
  addIntent,
  dueIntents,
  updateIntent,
} from "./autopilot-intents.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = ReturnType<typeof createPublicClient<any, any, any>>;

// The policy's allowed recipients live in a separate on-chain mapping, not in
// the getPolicy() struct, so membership must be checked via this view.
const IS_RECIPIENT_ALLOWED_ABI = [
  {
    type: "function",
    name: "isRecipientAllowed",
    stateMutability: "view",
    inputs: [
      { name: "policyId", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function sessionSignerFromKey(privateKey: Hex): QevieSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    getAddress: async () => account.address,
    signMessage: async (msg: Uint8Array | string): Promise<Hex> => {
      const raw = typeof msg === "string" ? msg : `0x${Buffer.from(msg).toString("hex")}`;
      return account.signMessage({ message: { raw: raw as Hex } });
    },
  };
}

function getPublicClient(): AnyPublicClient {
  return createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
}

/**
 * Reconcile a submitted UserOperation against its receipt for longer than the
 * SDK's default wait. QIE's bundler can mine an op but lag on indexing the
 * receipt, so a short wait reports a timeout as failure. Returns the resolved
 * receipt (mined or genuinely reverted), or null if still unconfirmed.
 */
async function confirmReceipt(
  client: ReturnType<typeof createQevieClient>,
  userOpHash: Hex,
  maxMs = 90_000,
  intervalMs = 3_000,
): Promise<UserOpResult | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const receipt = await client.bundler.getUserOperationReceipt(userOpHash);
    if (receipt !== null && receipt.status !== "pending") return receipt;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * Resolve the gas mode for a session payment from the policy's preferences and
 * the account's remaining sponsored quota. Returns null when the policy says to
 * pause because no acceptable gas route is currently available.
 */
async function resolveSessionGasMode(
  publicClient: AnyPublicClient,
  policy: AgentPolicy,
  smartAccount: Address,
): Promise<{ mode: GasMode; allowlistToken?: AllowlistToken } | null> {
  if (policy.allowSponsoredGas) {
    let freeOps = 0;
    try {
      freeOps = Number(await publicClient.readContract({
        address: CONTRACTS.paymaster,
        abi: PAYMASTER_ABI,
        functionName: "remainingFreeOps",
        args: [smartAccount],
      }) as bigint);
    } catch {
      freeOps = 0;
    }
    if (freeOps > 0) {
      const token = await issueAllowlistToken(smartAccount);
      if (token !== null) return { mode: "sponsored", allowlistToken: token };
    }
  }
  if (policy.allowQusdcGas) return { mode: "qusdc" };
  if (policy.allowNativeQieFallback) return { mode: "self" };
  // No route available right now. If the policy says to pause, skip this run and
  // retry later; otherwise fall back to QUSDC-pay as a best effort.
  if (policy.pauseWhenGasUnavailable) return null;
  return { mode: "qusdc" };
}

function formatQusdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole.toString()}.${fraction}`;
}

async function runIntent(
  intent: AutopilotIntent,
  publicClient: AnyPublicClient,
  client: ReturnType<typeof createQevieClient>,
): Promise<void> {
  const amount = BigInt(intent.amount);

  // Re-read the policy on every run: it may have been revoked, expired, or
  // emptied of budget since the intent was scheduled.
  const policy = await client.agent.getSessionPolicy(intent.policyId);
  const now = Math.floor(Date.now() / 1000);
  if (!policy.active || policy.guardianRevoked) {
    updateIntent(intent.id, { status: "failed", lastError: "Policy is inactive or revoked." });
    return;
  }
  if (policy.validUntil <= BigInt(now)) {
    updateIntent(intent.id, { status: "failed", lastError: "Policy has expired." });
    return;
  }
  if (amount > policy.maxPerTx) {
    updateIntent(intent.id, { status: "failed", lastError: "Amount exceeds policy max-per-tx." });
    return;
  }

  const privateKey = getSessionPrivateKey(intent.sessionKey);
  if (privateKey === null) {
    updateIntent(intent.id, {
      status: "failed",
      lastError: "Session key is not custodied by this service.",
    });
    return;
  }

  const gas = await resolveSessionGasMode(publicClient, policy, intent.smartAccount);
  if (gas === null) {
    // Policy paused for lack of gas: leave scheduled and retry on the next tick.
    console.log(`[autopilot] intent ${intent.id} paused — no gas route available`);
    return;
  }

  const signer = sessionSignerFromKey(privateKey);
  let result: UserOpResult;
  try {
    result = await client.agent.executeAutopilotPayment(
      signer,
      {
        smartAccount: intent.smartAccount,
        policyId: intent.policyId,
        recipient: intent.recipient,
        amount,
        mode: gas.mode,
      },
      gas.allowlistToken,
    );
  } catch (e) {
    // The op may already have been submitted when this threw, so stop the intent
    // rather than let the outer loop retry it and risk a double payment.
    updateIntent(intent.id, {
      status: "failed",
      lastError: `Payment submission error — review before rescheduling: ${e instanceof Error ? e.message : "unknown"}`,
    });
    console.error(`[autopilot] intent ${intent.id} submit error:`, e);
    return;
  }

  // The op is already submitted. If the short SDK wait did not confirm it, keep
  // reconciling against the receipt — but NEVER auto-retry an unconfirmed op, or
  // a recurring intent could double-pay an op that actually mined.
  if (result.status !== "mined") {
    const reconciled = await confirmReceipt(client, result.userOpHash);
    if (reconciled !== null) result = reconciled;
  }

  if (result.status !== "mined" || result.txHash === null) {
    const reverted = result.status === "failed" && result.txHash !== null;
    updateIntent(intent.id, {
      status: "failed",
      ...(result.txHash !== null ? { lastTxHash: result.txHash } : {}),
      lastError: reverted
        ? "Payment reverted on-chain."
        : `Payment could not be confirmed (userOp ${result.userOpHash}). Stopped to avoid a double payment — review before rescheduling.`,
    });
    console.error(`[autopilot] intent ${intent.id} not confirmed (status=${result.status})`);
    return;
  }

  const runsCompleted = intent.runsCompleted + 1;
  const done = intent.intervalSeconds === null || runsCompleted >= intent.maxRuns;
  updateIntent(intent.id, {
    runsCompleted,
    lastTxHash: result.txHash,
    lastError: undefined,
    status: done ? "completed" : "scheduled",
    nextRunAt: done
      ? intent.nextRunAt
      : intent.nextRunAt + (intent.intervalSeconds as number),
  });
  console.log(`[autopilot] intent ${intent.id} run ${runsCompleted}/${intent.maxRuns} tx=${result.txHash}`);

  // Receipts are best-effort: a receipt failure must not undo a settled payment.
  try {
    await issueReceipt({
      payer: intent.smartAccount,
      payee: intent.recipient,
      token: CONTRACTS.qusdc,
      amount: formatQusdc(amount),
      amountPrivate: false,
      metadataHash: hashReceiptMetadata({
        source: "autopilot-executor",
        intentId: intent.id,
        policyId: intent.policyId,
        run: runsCompleted,
        userOpHash: result.userOpHash,
        txHash: result.txHash,
      }),
      receiptType: "SINGLE_PAYMENT",
      paymentReference: result.txHash,
    });
  } catch (e) {
    console.error(`[autopilot] receipt issue failed for intent ${intent.id}:`, e);
  }
}

export async function runAutopilotOnce(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = dueIntents(now);
  if (due.length === 0) return;

  const publicClient = getPublicClient();
  const client = createQevieClient({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    paymasterServiceUrl: "",
    contracts: CONTRACTS,
  });

  for (const intent of due) {
    try {
      await runIntent(intent, publicClient, client);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      // For one-shot intents a hard error fails them; recurring intents keep
      // their schedule and retry on the next tick.
      updateIntent(intent.id, {
        lastError: message,
        ...(intent.intervalSeconds === null ? { status: "failed" as const } : {}),
      });
      console.error(`[autopilot] error running intent ${intent.id}:`, e);
    }
  }
}

export interface CreateIntentParams {
  smartAccount: Address;
  policyId: Hex;
  recipient: Address;
  amount: bigint;
  intervalSeconds: number | null;
  maxRuns: number;
  startAt: number;
}

/**
 * Validate a proposed intent against its on-chain policy and enqueue it. Throws
 * a user-facing message if the intent is not permitted by the policy, so a bad
 * intent is rejected at enqueue time rather than failing later on-chain.
 */
export async function createValidatedIntent(params: CreateIntentParams): Promise<AutopilotIntent> {
  const client = createQevieClient({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    paymasterServiceUrl: "",
    contracts: CONTRACTS,
  });

  let policy: AgentPolicy;
  try {
    policy = await client.agent.getSessionPolicy(params.policyId);
  } catch {
    // getPolicy reverts (PolicyNotFound) for an unknown id.
    throw new Error("Policy not found.");
  }
  if (policy.smartAccount.toLowerCase() !== params.smartAccount.toLowerCase()) {
    throw new Error("Policy does not belong to this account.");
  }
  if (!policy.active || policy.guardianRevoked) {
    throw new Error("Policy is inactive or revoked.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (policy.validUntil <= BigInt(now)) {
    throw new Error("Policy has expired.");
  }
  if (!policy.allowSinglePayment) {
    throw new Error("Policy does not allow single payments.");
  }
  if (params.amount <= 0n || params.amount > policy.maxPerTx) {
    throw new Error("Amount must be greater than zero and within the policy's max-per-tx limit.");
  }
  const manager = CONTRACTS.agentPolicyManager;
  if (manager === undefined) {
    throw new Error("AgentPolicyManager is not configured for this chain.");
  }
  const recipientAllowed = await getPublicClient().readContract({
    address: manager,
    abi: IS_RECIPIENT_ALLOWED_ABI,
    functionName: "isRecipientAllowed",
    args: [params.policyId, params.recipient],
  }) as boolean;
  if (!recipientAllowed) {
    throw new Error("Recipient is not allowed by this policy.");
  }
  if (getSessionPrivateKey(policy.sessionKey) === null) {
    throw new Error(
      "This policy's session key is not managed by the service, so it cannot be automated here.",
    );
  }

  return addIntent({
    policyId: params.policyId,
    smartAccount: params.smartAccount,
    sessionKey: policy.sessionKey,
    recipient: params.recipient,
    amount: params.amount.toString(),
    intervalSeconds: params.intervalSeconds,
    maxRuns: params.maxRuns,
    startAt: params.startAt,
  });
}

export function startAutopilotExecutor(): void {
  if (!AUTOPILOT_EXECUTOR_ENABLED) {
    console.log("[autopilot] executor disabled (AUTOPILOT_EXECUTOR_ENABLED=false)");
    return;
  }
  console.log(`[autopilot] executor starting with poll interval ${AUTOPILOT_POLL_INTERVAL_MS}ms`);
  void runAutopilotOnce();
  setInterval(() => { void runAutopilotOnce(); }, AUTOPILOT_POLL_INTERVAL_MS);
}
