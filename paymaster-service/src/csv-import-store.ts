/**
 * Bulk Intent Import — persistence.
 *
 * Two JSON-file stores mirroring the Autopilot intent store pattern
 * (`autopilot-intents.ts`): one for jobs, one for per-row payment intents.
 * Whole-array load/save keeps the model simple and crash-restart safe; the row
 * `status` + `intentKey` are the idempotency source of truth, so a process that
 * dies mid-execution resumes correctly by skipping confirmed rows.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import type {
  DuplicateWarning,
  IntentType,
  PolicyPreviewStatus,
} from "@qevie/sdk";
import { CSV_IMPORT_INTENT_STORE_PATH, CSV_IMPORT_JOB_STORE_PATH } from "./config.js";

export type JobSource = "user" | "autopilot";

export type JobStatus =
  | "parsing"
  | "resolved"
  | "deduped"
  | "policy_checked"
  | "previewed"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "partially_completed"
  | "cancelled"
  | "failed";

/** Per-row lifecycle status, tracked independently of the job status. */
export type RowStatus =
  | "valid"
  | "needs_review"
  | "blocked"
  | "executing"
  | "confirmed"
  | "failed";

export interface JobCounts {
  total: number;
  valid: number;
  needsReview: number;
  duplicates: number;
  blocked: number;
  confirmed: number;
  failed: number;
}

export interface CsvImportJob {
  jobId: string;
  uploadedBy?: Address;
  smartAccount: Address;
  fileName: string;
  source: JobSource;
  policyId?: Hex;
  status: JobStatus;
  allowDuplicateRows: boolean;
  counts: JobCounts;
  /** Sum of valid (executable) rows, in QUSDC base units, as a string. */
  totalBaseUnits: string;
  /** Display rail label, e.g. "Batch payment" / "Autopilot session". */
  rail?: string;
  /** Display gas mode label (SPONSORED_ONBOARDING / QUSDC_GAS / ...). */
  gasMode?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface PaymentIntentRecord {
  jobId: string;
  rowIndex: number;
  type: IntentType;
  recipientInput: string;
  resolvedAddress?: Address;
  resolutionSource?: string;
  resolutionVerified?: boolean;
  /** QUSDC amount in base units (6 decimals) as a string for JSON safety. */
  amount: string;
  memo: string;
  /** Canonical schedule string for subscriptions; absent for one-off rows. */
  scheduleSpec?: string;
  intentKey: Hex;
  contentKey?: Hex;
  status: RowStatus;
  policyStatus: PolicyPreviewStatus;
  warnings: DuplicateWarning[];
  /** Highest-severity duplicate finding for this row, or absent. */
  duplicateSeverity?: "block" | "warn";
  blockReason?: string;
  /** Intake/resolution errors that made the row unusable. */
  parseErrors?: string[];
  chunkIndex?: number;
  userOpHash?: Hex;
  txHash?: Hex;
  receiptId?: Hex;
}

// ---------------------------------------------------------------------------
// Generic JSON-array store
// ---------------------------------------------------------------------------

function load<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T[];
  } catch {
    return [];
  }
}

function save<T>(path: string, items: T[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(items, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function loadJobs(): CsvImportJob[] {
  return load<CsvImportJob>(CSV_IMPORT_JOB_STORE_PATH());
}

export function saveJobs(jobs: CsvImportJob[]): void {
  save(CSV_IMPORT_JOB_STORE_PATH(), jobs);
}

export function getJob(jobId: string): CsvImportJob | undefined {
  return loadJobs().find((j) => j.jobId === jobId);
}

export function putJob(job: CsvImportJob): void {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.jobId === job.jobId);
  if (idx === -1) jobs.push(job);
  else jobs[idx] = job;
  saveJobs(jobs);
}

export function updateJob(jobId: string, patch: Partial<CsvImportJob>): CsvImportJob | undefined {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1) return undefined;
  const next = { ...(jobs[idx] as CsvImportJob), ...patch, updatedAt: Math.floor(Date.now() / 1000) };
  jobs[idx] = next;
  saveJobs(jobs);
  return next;
}

export function jobsByStatus(status: JobStatus): CsvImportJob[] {
  return loadJobs().filter((j) => j.status === status);
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export function loadIntents(): PaymentIntentRecord[] {
  return load<PaymentIntentRecord>(CSV_IMPORT_INTENT_STORE_PATH());
}

export function saveIntents(intents: PaymentIntentRecord[]): void {
  save(CSV_IMPORT_INTENT_STORE_PATH(), intents);
}

export function intentsForJob(jobId: string): PaymentIntentRecord[] {
  return loadIntents()
    .filter((i) => i.jobId === jobId)
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

/** Replace all intents for a job (used during the synchronous preview pipeline). */
export function replaceIntentsForJob(jobId: string, rows: PaymentIntentRecord[]): void {
  const others = loadIntents().filter((i) => i.jobId !== jobId);
  saveIntents([...others, ...rows]);
}

export function updateIntent(
  jobId: string,
  rowIndex: number,
  patch: Partial<PaymentIntentRecord>,
): void {
  const intents = loadIntents();
  const idx = intents.findIndex((i) => i.jobId === jobId && i.rowIndex === rowIndex);
  if (idx === -1) return;
  intents[idx] = { ...(intents[idx] as PaymentIntentRecord), ...patch };
  saveIntents(intents);
}

/** Recompute job counts from its intents and persist them. */
export function recountJob(jobId: string): CsvImportJob | undefined {
  const rows = intentsForJob(jobId);
  const counts: JobCounts = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    duplicates: rows.filter((r) => r.duplicateSeverity !== undefined).length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
  const totalBaseUnits = rows
    .filter((r) => r.status === "valid" || r.status === "executing" || r.status === "confirmed")
    .reduce((sum, r) => sum + BigInt(r.amount), 0n)
    .toString();
  return updateJob(jobId, { counts, totalBaseUnits });
}
