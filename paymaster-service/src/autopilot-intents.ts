/**
 * Autopilot intent store.
 *
 * An intent is a scheduled (optionally recurring) payment the user has
 * pre-authorized through an on-chain Autopilot policy. The executor loop picks
 * due intents and runs them with the policy's server-custodied session key,
 * bounded by the on-chain caps. Intents are persisted to a JSON file so they
 * survive restarts.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import { AUTOPILOT_INTENT_STORE_PATH } from "./config.js";

export type IntentStatus = "scheduled" | "completed" | "failed" | "cancelled";

export interface AutopilotIntent {
  id: string;
  policyId: Hex;
  smartAccount: Address;
  sessionKey: Address;
  recipient: Address;
  /** QUSDC amount in base units (6 decimals), as a string for JSON safety. */
  amount: string;
  /** Recurring interval in seconds; null for a one-shot intent. */
  intervalSeconds: number | null;
  /** Total number of runs to perform (1 for one-shot). */
  maxRuns: number;
  runsCompleted: number;
  /** Unix seconds of the next scheduled run. */
  nextRunAt: number;
  status: IntentStatus;
  createdAt: number;
  lastTxHash?: Hex;
  lastError?: string;
}

export interface NewIntent {
  policyId: Hex;
  smartAccount: Address;
  sessionKey: Address;
  recipient: Address;
  amount: string;
  intervalSeconds: number | null;
  maxRuns: number;
  startAt: number;
}

function storePath(): string {
  return AUTOPILOT_INTENT_STORE_PATH();
}

export function loadIntents(): AutopilotIntent[] {
  const path = storePath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AutopilotIntent[];
  } catch {
    return [];
  }
}

function saveIntents(intents: AutopilotIntent[]): void {
  const path = storePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(intents, null, 2), { mode: 0o600 });
}

export function addIntent(input: NewIntent): AutopilotIntent {
  const intents = loadIntents();
  const intent: AutopilotIntent = {
    id: randomUUID(),
    policyId: input.policyId,
    smartAccount: input.smartAccount,
    sessionKey: input.sessionKey,
    recipient: input.recipient,
    amount: input.amount,
    intervalSeconds: input.intervalSeconds,
    maxRuns: input.maxRuns,
    runsCompleted: 0,
    nextRunAt: input.startAt,
    status: "scheduled",
    createdAt: Math.floor(Date.now() / 1000),
  };
  intents.push(intent);
  saveIntents(intents);
  return intent;
}

export function updateIntent(id: string, patch: Partial<AutopilotIntent>): void {
  const intents = loadIntents();
  const index = intents.findIndex((i) => i.id === id);
  if (index === -1) return;
  intents[index] = { ...intents[index], ...patch } as AutopilotIntent;
  saveIntents(intents);
}

export function listIntents(smartAccount?: Address): AutopilotIntent[] {
  const intents = loadIntents();
  if (smartAccount === undefined) return intents;
  const target = smartAccount.toLowerCase();
  return intents.filter((i) => i.smartAccount.toLowerCase() === target);
}

export function cancelIntent(id: string, smartAccount: Address): boolean {
  const intents = loadIntents();
  const index = intents.findIndex(
    (i) => i.id === id && i.smartAccount.toLowerCase() === smartAccount.toLowerCase(),
  );
  if (index === -1) return false;
  const intent = intents[index] as AutopilotIntent;
  if (intent.status === "scheduled") {
    intents[index] = { ...intent, status: "cancelled" };
    saveIntents(intents);
  }
  return true;
}

/** Scheduled intents whose next run is due at or before `now` (unix seconds). */
export function dueIntents(now: number): AutopilotIntent[] {
  return loadIntents().filter((i) => i.status === "scheduled" && i.nextRunAt <= now);
}
