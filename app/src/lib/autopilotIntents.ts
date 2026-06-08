import type { Address, Hex } from "viem";
import { APP_CONFIG } from "../config.js";

export interface AutopilotIntent {
  id: string;
  policyId: Hex;
  smartAccount: Address;
  sessionKey: Address;
  recipient: Address;
  amount: string;
  intervalSeconds: number | null;
  maxRuns: number;
  runsCompleted: number;
  nextRunAt: number;
  status: "scheduled" | "confirming" | "completed" | "failed" | "cancelled";
  createdAt: number;
  lastTxHash?: Hex;
  pendingUserOpHash?: Hex;
  lastError?: string;
}

export interface ScheduleIntentInput {
  smartAccount: Address;
  policyId: Hex;
  recipient: Address;
  /** QUSDC amount in base units (6 decimals). */
  amount: bigint;
  intervalSeconds: number | null;
  maxRuns: number;
  startAt?: number;
}

const base = APP_CONFIG.paymasterServiceUrl;

async function parse(res: Response): Promise<{ intent?: AutopilotIntent; intents?: AutopilotIntent[]; error?: string }> {
  return (await res.json().catch(() => ({}))) as {
    intent?: AutopilotIntent;
    intents?: AutopilotIntent[];
    error?: string;
  };
}

/** Schedule an Autopilot payment. The policy must allow the recipient and amount. */
export async function scheduleIntent(input: ScheduleIntentInput): Promise<AutopilotIntent> {
  const res = await fetch(`${base}/autopilot/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      smartAccount: input.smartAccount,
      policyId: input.policyId,
      recipient: input.recipient,
      amount: input.amount.toString(),
      intervalSeconds: input.intervalSeconds,
      maxRuns: input.maxRuns,
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
    }),
  });
  const data = await parse(res);
  if (!res.ok || data.intent === undefined) {
    throw new Error(data.error ?? "Could not schedule the payment.");
  }
  return data.intent;
}

/** List Autopilot intents for a smart account. */
export async function listIntents(smartAccount: Address): Promise<AutopilotIntent[]> {
  const res = await fetch(`${base}/autopilot/intents?smartAccount=${smartAccount}`);
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error ?? "Could not load scheduled payments.");
  return data.intents ?? [];
}

/** Cancel a scheduled Autopilot intent. */
export async function cancelIntent(id: string, smartAccount: Address): Promise<void> {
  const res = await fetch(`${base}/autopilot/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, smartAccount }),
  });
  if (!res.ok) {
    const data = await parse(res);
    throw new Error(data.error ?? "Could not cancel the payment.");
  }
}
