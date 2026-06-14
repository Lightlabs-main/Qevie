import type { Address, Hex } from "viem";

/**
 * Bulk Intent Import — shared, environment-agnostic types.
 *
 * Everything here is pure data. The deterministic pipeline (parse → normalize →
 * key → dedupe → policy-mirror → compose) is built from these so both the
 * paymaster-service and the app reuse identical logic, and so the money path can
 * be unit-tested with no network, no LLM, and no on-chain calls.
 */

/** Supported payment rails for a CSV row. */
export type IntentType = "pay" | "request" | "subscription";

/** The CSV header columns this importer understands. */
export const CSV_COLUMNS = ["type", "recipient", "amount", "memo", "schedule"] as const;

/** A raw CSV row as parsed from text, before normalization/validation. */
export interface RawCsvRow {
  /** 0-based index among DATA rows (header excluded). */
  rowIndex: number;
  type: string;
  recipient: string;
  amount: string;
  memo: string;
  schedule: string;
}

/** Recurrence kinds a `subscription` schedule cell can deterministically map to. */
export type ScheduleKind = "daily" | "weekly" | "monthly";

/** A structured, validated schedule spec (only ever produced for subscriptions). */
export interface ScheduleSpec {
  kind: ScheduleKind;
  /** Day-of-week 0-6 (Sun=0) when the schedule pins a weekday; omitted otherwise. */
  dayOfWeek?: number;
  /** Period length in seconds (deterministically derived; ≥ 1 day). */
  periodSeconds: number;
  /**
   * Canonical lowercase string used inside the contentKey, e.g. `weekly:5`,
   * `weekly`, `daily`, `monthly`. Empty string for one-off (non-subscription)
   * rows so their contentKey is stable.
   */
  canonical: string;
}

/** A normalized, validated row ready for resolution + hashing. */
export interface NormalizedRow {
  rowIndex: number;
  type: IntentType;
  recipientInput: string;
  /** Amount in QUSDC base units (6 decimals). Always > 0. */
  amount: bigint;
  /** Whitespace-normalized memo (may be ""). */
  memo: string;
  /** Structured schedule for subscriptions; null for one-off rows. */
  scheduleSpec: ScheduleSpec | null;
}

export type RowErrorField = "type" | "recipient" | "amount" | "memo" | "schedule" | "row";

export interface RowError {
  rowIndex: number;
  field: RowErrorField;
  message: string;
}

export type NormalizeResult =
  | { ok: true; row: NormalizedRow }
  | { ok: false; errors: RowError[] };

/** Result of parsing raw CSV text into rows. */
export interface ParseCsvResult {
  rows: RawCsvRow[];
  /**
   * Set when the file as a whole is unparseable (missing required columns, no
   * header, etc.). When present, `rows` is empty and the whole upload is
   * rejected — this is the ONLY whole-file abort.
   */
  fileError?: string;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export type DuplicateCheck =
  | "same_file"
  | "same_recipient_amount"
  | "resolution_collision"
  | "history";

/** `block` = potential double-spend, refuse by default. `warn` = annoyance only. */
export type DuplicateSeverity = "block" | "warn";

export interface DuplicateWarning {
  rowIndex: number;
  check: DuplicateCheck;
  severity: DuplicateSeverity;
  message: string;
  /** Other row indices implicated (same-file / collision / same recipient). */
  relatedRows?: number[];
}

/** The minimal, post-resolution shape the duplicate sentry needs. */
export interface DedupeRow {
  rowIndex: number;
  type: IntentType;
  /** Resolved recipient address, lowercased. */
  resolvedAddress: Address;
  amount: bigint;
  memo: string;
  contentKey: Hex;
  recipientInput: string;
}

export interface DedupeOptions {
  /** contentKeys seen in history within the lookback window (receipts, pending, prior jobs). */
  historyContentKeys?: Iterable<Hex>;
}

// ---------------------------------------------------------------------------
// Policy preview (advisory mirror of the on-chain AgentPolicy)
// ---------------------------------------------------------------------------

export type PolicyPreviewStatus = "valid" | "needs_review" | "blocked";

/**
 * The subset of the on-chain AgentPolicy the off-chain preview mirrors. This is
 * a FAIL-FAST MIRROR for UX only — the AgentPolicyManager remains the authority
 * and enforces all of this again at `executeSession`.
 */
export interface PolicyMirror {
  active: boolean;
  guardianRevoked: boolean;
  validAfter: bigint;
  validUntil: bigint;
  maxPerTx: bigint;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  totalLimit: bigint;
  spentToday: bigint;
  spentThisWeek: bigint;
  spentTotal: bigint;
  allowSinglePayment: boolean;
  allowBatchPayment: boolean;
  allowPaymentRequest: boolean;
  allowSubscription: boolean;
}

export interface PolicyPreviewRow {
  rowIndex: number;
  type: IntentType;
  amount: bigint;
  /** Whether the resolved address is on the policy's on-chain recipient allowlist. */
  recipientAllowed: boolean;
}

export interface PolicyPreviewResult {
  rowIndex: number;
  status: PolicyPreviewStatus;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Execution selection (idempotency + duplicate gate)
// ---------------------------------------------------------------------------

/** Per-row lifecycle status, tracked independently of the job status. */
export type IntentStatus =
  | "valid"
  | "needs_review"
  | "blocked"
  | "executing"
  | "confirmed"
  | "failed";

export interface SelectableIntent {
  rowIndex: number;
  intentKey: Hex;
  type: IntentType;
  status: IntentStatus;
  policyStatus: PolicyPreviewStatus;
  /** Highest-severity duplicate finding for this row, or null when not a duplicate. */
  duplicateSeverity: DuplicateSeverity | null;
}
