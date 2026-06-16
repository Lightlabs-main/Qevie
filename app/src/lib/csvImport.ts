import type { Address, Hex } from "viem";
import { APP_CONFIG } from "../config.js";

/**
 * Bulk Intent Import — service client. Thin fetch wrappers over the
 * paymaster-service `/csv-import` endpoints, mirroring the existing
 * `autopilotIntents.ts` shape.
 */

export type IntentType = "pay" | "request" | "subscription";
export type RowStatus =
  | "valid"
  | "needs_review"
  | "blocked"
  | "executing"
  | "confirmed"
  | "failed";
export type PolicyPreviewStatus = "valid" | "needs_review" | "blocked";
export type DuplicateSeverity = "block" | "warn";
export type DuplicateCheck =
  | "same_file"
  | "same_recipient_amount"
  | "resolution_collision"
  | "history";

export interface DuplicateWarning {
  rowIndex: number;
  check: DuplicateCheck;
  severity: DuplicateSeverity;
  message: string;
  relatedRows?: number[];
}

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
  smartAccount: Address;
  fileName: string;
  source: "user" | "autopilot";
  policyId?: Hex;
  status: string;
  allowDuplicateRows: boolean;
  counts: JobCounts;
  totalBaseUnits: string;
  rail?: string;
  gasMode?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface PaymentIntent {
  jobId: string;
  rowIndex: number;
  type: IntentType;
  recipientInput: string;
  resolvedAddress?: Address;
  resolutionSource?: string;
  resolutionVerified?: boolean;
  amount: string;
  memo: string;
  scheduleSpec?: string;
  intentKey: Hex;
  contentKey?: Hex;
  status: RowStatus;
  policyStatus: PolicyPreviewStatus;
  warnings: DuplicateWarning[];
  duplicateSeverity?: DuplicateSeverity;
  blockReason?: string;
  parseErrors?: string[];
  chunkIndex?: number;
  userOpHash?: Hex;
  txHash?: Hex;
  receiptId?: Hex;
}

export interface JobView {
  job: CsvImportJob;
  intents: PaymentIntent[];
}

export interface PlanChunk {
  chunkIndex: number;
  batchId: Hex;
  recipients: Array<{ rowIndex: number; to: Address; amount: string }>;
}

export interface ExecutionPlan {
  payChunks: PlanChunk[];
  singles: Array<{ rowIndex: number; type: IntentType; to: Address; amount: string; scheduleSpec?: string }>;
}

export interface ApproveResult {
  job: CsvImportJob;
  plan?: ExecutionPlan;
}

const base = APP_CONFIG.paymasterServiceUrl;

async function asJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Bulk import request failed.");
  }
  return data;
}

export interface CreateJobInput {
  fileName: string;
  csvText: string;
  smartAccount: Address;
  uploadedBy?: Address;
  source?: "user" | "autopilot";
  policyId?: Hex;
  allowDuplicateRows?: boolean;
}

export async function createImportJob(input: CreateJobInput): Promise<JobView> {
  const res = await fetch(`${base}/csv-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "user", ...input }),
  });
  return asJson<JobView>(res);
}

export async function getImportJob(jobId: string): Promise<JobView> {
  return asJson<JobView>(await fetch(`${base}/csv-import/${jobId}`));
}

export async function approveImportJob(
  jobId: string,
  body: { allowDuplicateRows?: boolean; rowOverrides?: Array<{ rowIndex: number; action: "remove" | "keep" }> },
): Promise<ApproveResult> {
  const res = await fetch(`${base}/csv-import/${jobId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson<ApproveResult>(res);
}

export async function confirmImportRows(
  jobId: string,
  body: {
    rowIndexes: number[];
    userOpHash?: Hex;
    txHash?: Hex;
    receiptType?: "BATCH_PAYMENT" | "SINGLE_PAYMENT" | "PAYMENT_REQUEST_SETTLED" | "SUBSCRIPTION_PAYMENT";
    failed?: boolean;
  },
): Promise<{ job: CsvImportJob }> {
  const res = await fetch(`${base}/csv-import/${jobId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson<{ job: CsvImportJob }>(res);
}

export async function resumeImportJob(jobId: string): Promise<ApproveResult> {
  return asJson<ApproveResult>(await fetch(`${base}/csv-import/${jobId}/resume`, { method: "POST" }));
}

export async function cancelImportJob(jobId: string): Promise<{ job: CsvImportJob }> {
  return asJson<{ job: CsvImportJob }>(await fetch(`${base}/csv-import/${jobId}/cancel`, { method: "POST" }));
}

/** Short label for a resolution source. */
export function sourceLabel(source?: string): string {
  switch (source) {
    case "direct_address":
      return "address";
    case "qie_domain_resolver":
      return ".qie domain";
    case "qevie_username_registry":
      return "username";
    default:
      return source ?? "unknown";
  }
}
