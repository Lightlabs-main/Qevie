/**
 * Bulk Intent Import — service orchestration.
 *
 * This module wires the SDK's pure, deterministic helpers (parse → normalize →
 * resolve → dedupe → policy-mirror → compose → idempotent select) to the JSON
 * stores, the resolver, the on-chain policy reads, and execution. It builds NO
 * new payment engine: the user path reuses `client.batchPay()/pay()/subscribe()`
 * (executed app-side, user-signed) and the Autopilot path reuses
 * `client.executeAutopilotPayment()` per row under an existing policyId.
 *
 * Idempotency is enforced off-chain: an intent whose `intentKey` is already
 * confirmed is never re-submitted, so a partially-completed job is safe to
 * resume after a crash or partial failure.
 */

import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createQevieClient,
  hashReceiptMetadata,
  toBuilderGasMode,
  parseCsvRows,
  normalizeRow,
  computeIntentKey,
  computeContentKey,
  detectDuplicates,
  highestSeverity,
  previewPolicyForRows,
  deterministicBatchId,
  chunk,
  selectExecutableRows,
  type AgentPolicy,
  type AllowlistToken,
  type GasMode,
  type QevieSigner,
  type UserOpResult,
  type DedupeRow,
  type DuplicateWarning,
  type IntentType,
  type NormalizedRow,
  type PolicyMirror,
  type PolicyPreviewRow,
  type SelectableIntent,
} from "@qevie/sdk";
import {
  CHAIN_ID,
  RPC_URL,
  BUNDLER_URL,
  CONTRACTS,
  CSV_IMPORT_BATCH_CHUNK_SIZE,
  CSV_IMPORT_EXECUTOR_ENABLED,
  CSV_IMPORT_LOOKBACK_HOURS,
  CSV_IMPORT_MAX_ROWS,
  CSV_IMPORT_POLL_INTERVAL_MS,
} from "./config.js";
import {
  getJob,
  intentsForJob,
  jobsByStatus,
  loadIntents,
  putJob,
  recountJob,
  replaceIntentsForJob,
  updateIntent,
  updateJob,
  type CsvImportJob,
  type JobSource,
  type PaymentIntentRecord,
  type RowStatus,
} from "./csv-import-store.js";
import { resolveRecipientForPreview } from "./identity/resolve-recipient.js";
import { issueAllowlistToken } from "./allowlist.js";
import { issueReceipt } from "./receipts.js";
import { getSessionPrivateKey } from "./session-keys.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = ReturnType<typeof createPublicClient<any, any, any>>;

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

function getPublicClient(): AnyPublicClient {
  return createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
}

function getClient(): ReturnType<typeof createQevieClient> {
  return createQevieClient({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    paymasterServiceUrl: "",
    contracts: CONTRACTS,
  });
}

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

function lower(addr: Address): Address {
  return addr.toLowerCase() as Address;
}

// ---------------------------------------------------------------------------
// Pipeline: create job (runs through "previewed")
// ---------------------------------------------------------------------------

export interface CreateJobInput {
  fileName: string;
  csvText: string;
  smartAccount: Address;
  uploadedBy?: Address;
  source: JobSource;
  policyId?: Hex;
  allowDuplicateRows: boolean;
}

interface PreparedRow {
  normalized: NormalizedRow;
  resolvedAddress?: Address;
  resolutionSource?: string;
  resolutionVerified?: boolean;
  contentKey?: Hex;
  blockReason?: string;
}

/**
 * Build a job and run the deterministic pipeline synchronously through the
 * preview stage. Returns the persisted job (status "previewed"). Throws a
 * user-facing error only when the FILE is unparseable; per-row problems are
 * recorded on the rows, never aborted.
 */
export async function createJob(input: CreateJobInput): Promise<CsvImportJob> {
  const parsed = parseCsvRows(input.csvText);
  if (parsed.fileError !== undefined) {
    throw new Error(parsed.fileError);
  }
  if (parsed.rows.length === 0) {
    throw new Error("No data rows found in the file.");
  }
  if (parsed.rows.length > CSV_IMPORT_MAX_ROWS) {
    throw new Error(`Too many rows (${parsed.rows.length}). The limit is ${CSV_IMPORT_MAX_ROWS}.`);
  }

  const jobId = randomUUID();
  const smartAccount = lower(input.smartAccount);
  const now = Math.floor(Date.now() / 1000);

  const job: CsvImportJob = {
    jobId,
    smartAccount,
    fileName: input.fileName,
    source: input.source,
    status: "parsing",
    allowDuplicateRows: input.allowDuplicateRows,
    counts: { total: 0, valid: 0, needsReview: 0, duplicates: 0, blocked: 0, confirmed: 0, failed: 0 },
    totalBaseUnits: "0",
    createdAt: now,
    updatedAt: now,
    ...(input.uploadedBy !== undefined ? { uploadedBy: lower(input.uploadedBy) } : {}),
    ...(input.policyId !== undefined ? { policyId: input.policyId } : {}),
  };
  putJob(job);

  // --- Intake / normalize + Resolve (snapshot address + source) ------------
  const records: PaymentIntentRecord[] = [];
  const prepared: Array<PreparedRow | null> = [];

  for (const raw of parsed.rows) {
    const norm = normalizeRow(raw);
    if (!norm.ok) {
      prepared.push(null);
      const safeType = (["pay", "request", "subscription"] as IntentType[]).includes(
        raw.type.trim().toLowerCase() as IntentType,
      )
        ? (raw.type.trim().toLowerCase() as IntentType)
        : "pay";
      records.push({
        jobId,
        rowIndex: raw.rowIndex,
        type: safeType,
        recipientInput: raw.recipient.trim(),
        amount: "0",
        memo: raw.memo.trim(),
        intentKey: computeIntentKey(jobId, raw.rowIndex),
        status: "blocked",
        policyStatus: "blocked",
        warnings: [],
        blockReason: "Row could not be parsed.",
        parseErrors: norm.errors.map((e) => e.message),
      });
      continue;
    }

    const row = norm.row;
    const resolution = await resolveRecipientForPreview(row.recipientInput);
    const p: PreparedRow = { normalized: row };
    if (resolution.ok) {
      p.resolvedAddress = lower(resolution.address);
      p.resolutionSource = resolution.source;
      p.resolutionVerified = resolution.verified;
      p.contentKey = computeContentKey({
        smartAccount,
        resolvedAddress: p.resolvedAddress,
        token: CONTRACTS.qusdc,
        amount: row.amount,
        normalizedMemo: row.memo,
        scheduleSpec: row.scheduleSpec?.canonical ?? "",
      });
    } else {
      p.blockReason = `Could not resolve recipient "${row.recipientInput}": ${resolution.message}`;
    }
    prepared.push(p);
  }

  updateJob(jobId, { status: "resolved" });

  // --- Duplicate Sentry (after resolution; on snapshotted addresses) -------
  const dedupeRows: DedupeRow[] = [];
  for (const p of prepared) {
    if (p === null || p.resolvedAddress === undefined || p.contentKey === undefined) continue;
    dedupeRows.push({
      rowIndex: p.normalized.rowIndex,
      type: p.normalized.type,
      resolvedAddress: p.resolvedAddress,
      amount: p.normalized.amount,
      memo: p.normalized.memo,
      contentKey: p.contentKey,
      recipientInput: p.normalized.recipientInput,
    });
  }

  const historyContentKeys = collectHistoryContentKeys(jobId);
  const warnings = detectDuplicates(dedupeRows, { historyContentKeys });
  warnings.push(...(await receiptHistoryWarnings(dedupeRows, smartAccount)));
  const warningsByRow = new Map<number, DuplicateWarning[]>();
  for (const w of warnings) {
    const list = warningsByRow.get(w.rowIndex) ?? [];
    list.push(w);
    warningsByRow.set(w.rowIndex, list);
  }

  updateJob(jobId, { status: "deduped" });

  // --- Policy preview (advisory mirror) ------------------------------------
  let policyMirror: PolicyMirror | undefined;
  let recipientAllowed: Map<number, boolean> | undefined;
  let gasModeLabel: string | undefined;

  const client = getClient();
  const publicClient = getPublicClient();

  if (input.source === "autopilot") {
    if (input.policyId === undefined) throw new Error("policyId is required for an Autopilot import.");
    const policy = await client.agent.getSessionPolicy(input.policyId);
    if (lower(policy.smartAccount) !== smartAccount) {
      throw new Error("Policy does not belong to this smart account.");
    }
    policyMirror = toPolicyMirror(policy);
    recipientAllowed = new Map<number, boolean>();
    for (const dr of dedupeRows) {
      const allowed = (await publicClient.readContract({
        address: requireManager(),
        abi: IS_RECIPIENT_ALLOWED_ABI,
        functionName: "isRecipientAllowed",
        args: [input.policyId, dr.resolvedAddress],
      })) as boolean;
      recipientAllowed.set(dr.rowIndex, allowed);
    }
    try {
      const decision = await client.agent.getAutopilotGasStatus(input.policyId);
      gasModeLabel = decision.mode;
    } catch {
      gasModeLabel = undefined;
    }
  } else {
    try {
      const decision = await client.gas.resolveGasMode(smartAccount, {
        allowSponsoredGas: true,
        allowQusdcGas: true,
        allowNativeQieFallback: true,
        pauseWhenGasUnavailable: false,
      });
      gasModeLabel = decision.mode;
    } catch {
      gasModeLabel = undefined;
    }
  }

  const previewRows: PolicyPreviewRow[] = dedupeRows.map((dr) => ({
    rowIndex: dr.rowIndex,
    type: dr.type,
    amount: dr.amount,
    recipientAllowed: recipientAllowed?.get(dr.rowIndex) ?? true,
  }));
  const policyResults =
    policyMirror !== undefined
      ? previewPolicyForRows(policyMirror, previewRows, now)
      : previewRows.map((r) => ({ rowIndex: r.rowIndex, status: "valid" as const, reasons: [] as string[] }));
  const policyByRow = new Map(policyResults.map((r) => [r.rowIndex, r]));

  // --- Assemble + persist intent records -----------------------------------
  for (const p of prepared) {
    if (p === null) continue;
    const row = p.normalized;
    const rowWarnings = warningsByRow.get(row.rowIndex) ?? [];
    const severity = highestSeverity(rowWarnings);

    const record: PaymentIntentRecord = {
      jobId,
      rowIndex: row.rowIndex,
      type: row.type,
      recipientInput: row.recipientInput,
      amount: row.amount.toString(),
      memo: row.memo,
      intentKey: computeIntentKey(jobId, row.rowIndex),
      status: "valid",
      policyStatus: "valid",
      warnings: rowWarnings,
      ...(row.scheduleSpec !== null ? { scheduleSpec: row.scheduleSpec.canonical } : {}),
      ...(p.resolvedAddress !== undefined ? { resolvedAddress: p.resolvedAddress } : {}),
      ...(p.resolutionSource !== undefined ? { resolutionSource: p.resolutionSource } : {}),
      ...(p.resolutionVerified !== undefined ? { resolutionVerified: p.resolutionVerified } : {}),
      ...(p.contentKey !== undefined ? { contentKey: p.contentKey } : {}),
      ...(severity !== null ? { duplicateSeverity: severity } : {}),
    };

    if (p.blockReason !== undefined) {
      record.status = "blocked";
      record.policyStatus = "blocked";
      record.blockReason = p.blockReason;
    } else {
      // Autopilot executes single QUSDC transfers only — non-pay rails can't run
      // via executeSession, so block them honestly at preview time.
      if (input.source === "autopilot" && row.type !== "pay") {
        record.status = "blocked";
        record.policyStatus = "blocked";
        record.blockReason = "Autopilot executes single payments only; this rail can't run via a session.";
      } else {
        const pr = policyByRow.get(row.rowIndex);
        const status: RowStatus = (pr?.status ?? "valid") as RowStatus;
        record.policyStatus = pr?.status ?? "valid";
        record.status = status;
        if (pr !== undefined && pr.status === "blocked" && pr.reasons.length > 0) {
          record.blockReason = pr.reasons.join(" ");
        }
      }
    }

    records.push(record);
  }

  records.sort((a, b) => a.rowIndex - b.rowIndex);
  replaceIntentsForJob(jobId, records);

  const rail =
    input.source === "autopilot"
      ? "Autopilot session"
      : records.some((r) => r.type === "pay")
        ? "Batch payment"
        : "Manual rails";

  updateJob(jobId, {
    status: "previewed",
    rail,
    ...(gasModeLabel !== undefined ? { gasMode: gasModeLabel } : {}),
  });
  recountJob(jobId);

  return getJob(jobId) as CsvImportJob;
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

/** contentKeys seen in our own store within the lookback window (excludes this job). */
function collectHistoryContentKeys(currentJobId: string): Hex[] {
  const cutoff = Math.floor(Date.now() / 1000) - CSV_IMPORT_LOOKBACK_HOURS * 3600;
  const recentJobIds = new Set(
    jobsWithin(cutoff)
      .filter((j) => j.jobId !== currentJobId)
      .map((j) => j.jobId),
  );
  const keys: Hex[] = [];
  for (const intent of loadIntents()) {
    if (!recentJobIds.has(intent.jobId)) continue;
    if (intent.contentKey === undefined) continue;
    // Only rows that actually moved money (confirmed) or are in-flight
    // (executing) count as "already made (or is pending)". A row that was merely
    // previewed or approved-but-never-submitted is a draft, not a payment — so
    // counting "valid" rows here makes re-uploading (or re-previewing) the same
    // file falsely report every row as a duplicate of its own earlier draft.
    if (intent.status !== "confirmed" && intent.status !== "executing") continue;
    keys.push(intent.contentKey);
  }
  return keys;
}

function jobsWithin(cutoff: number): CsvImportJob[] {
  return [
    ...jobsByStatus("executing"),
    ...jobsByStatus("completed"),
    ...jobsByStatus("partially_completed"),
    ...jobsByStatus("previewed"),
    ...jobsByStatus("awaiting_approval"),
  ].filter((j) => j.updatedAt >= cutoff);
}

/**
 * Best-effort ReceiptRegistry history. Receipts don't carry our off-chain
 * contentKey, so this matches the weaker (recipient, amount) signal against
 * on-chain receipts within the lookback window and surfaces it as a `history`
 * warning. The precise contentKey history (above) remains the primary source.
 */
async function receiptHistoryWarnings(
  rows: DedupeRow[],
  smartAccount: Address,
): Promise<DuplicateWarning[]> {
  if (CONTRACTS.receiptRegistry === undefined || rows.length === 0) return [];
  try {
    const client = getClient();
    const receipts = await client.receipts.listByPayer(smartAccount);
    const cutoff = Math.floor(Date.now() / 1000) - CSV_IMPORT_LOOKBACK_HOURS * 3600;
    const seen = new Set<string>();
    for (const r of receipts) {
      if (r.timestamp < cutoff || r.amount === null) continue;
      // receipt.amount is a 2-dp QUSDC string; normalize to base units.
      const base = BigInt(Math.round(Number(r.amount) * 1e6));
      seen.add(`${lower(r.payee)}|${base.toString()}`);
    }
    const out: DuplicateWarning[] = [];
    for (const row of rows) {
      if (seen.has(`${row.resolvedAddress}|${row.amount.toString()}`)) {
        out.push({
          rowIndex: row.rowIndex,
          check: "history",
          severity: row.type === "request" ? "warn" : "block",
          message: "A receipt for the same recipient and amount already exists within the lookback window.",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Policy mirror
// ---------------------------------------------------------------------------

function toPolicyMirror(policy: AgentPolicy): PolicyMirror {
  return {
    active: policy.active,
    guardianRevoked: policy.guardianRevoked,
    validAfter: policy.validAfter,
    validUntil: policy.validUntil,
    maxPerTx: policy.maxPerTx,
    dailyLimit: policy.dailyLimit,
    weeklyLimit: policy.weeklyLimit,
    totalLimit: policy.totalLimit,
    spentToday: policy.spentToday,
    spentThisWeek: policy.spentThisWeek,
    spentTotal: policy.spentTotal,
    allowSinglePayment: policy.allowSinglePayment,
    allowBatchPayment: policy.allowBatchPayment,
    allowPaymentRequest: policy.allowPaymentRequest,
    allowSubscription: policy.allowSubscription,
  };
}

function requireManager(): Address {
  const manager = CONTRACTS.agentPolicyManager;
  if (manager === undefined) throw new Error("AgentPolicyManager is not configured for this chain.");
  return manager;
}

// ---------------------------------------------------------------------------
// Selection + execution plan
// ---------------------------------------------------------------------------

function toSelectable(intent: PaymentIntentRecord): SelectableIntent {
  return {
    rowIndex: intent.rowIndex,
    intentKey: intent.intentKey,
    type: intent.type,
    status: intent.status,
    policyStatus: intent.policyStatus,
    duplicateSeverity: intent.duplicateSeverity ?? null,
  };
}

export interface PlanChunk {
  chunkIndex: number;
  batchId: Hex;
  recipients: Array<{ rowIndex: number; to: Address; amount: string }>;
}

export interface ExecutionPlan {
  /** User-path batchPay chunks for `pay` rows. */
  payChunks: PlanChunk[];
  /** User-path single rows for request/subscription rails. */
  singles: Array<{
    rowIndex: number;
    type: IntentType;
    to: Address;
    amount: string;
    scheduleSpec?: string;
  }>;
}

/** Build the deterministic execution plan for the user-signed path. */
export function buildUserPlan(job: CsvImportJob): ExecutionPlan {
  const intents = intentsForJob(job.jobId);
  const confirmed = intents.filter((i) => i.status === "confirmed").map((i) => i.intentKey);
  const selected = selectExecutableRows(intents.map(toSelectable), {
    allowDuplicateRows: job.allowDuplicateRows,
    isAutopilot: false,
    confirmedIntentKeys: confirmed,
  });
  const selectedByRow = new Map(intents.map((i) => [i.rowIndex, i]));

  const payRows = selected
    .filter((s) => s.type === "pay")
    .map((s) => selectedByRow.get(s.rowIndex))
    .filter((r): r is PaymentIntentRecord => r !== undefined && r.resolvedAddress !== undefined);

  const chunks = chunk(payRows, CSV_IMPORT_BATCH_CHUNK_SIZE);
  const payChunks: PlanChunk[] = chunks.map((rows, chunkIndex) => ({
    chunkIndex,
    batchId: deterministicBatchId(job.jobId, chunkIndex),
    recipients: rows.map((r) => ({
      rowIndex: r.rowIndex,
      to: r.resolvedAddress as Address,
      amount: r.amount,
    })),
  }));

  const singles = selected
    .filter((s) => s.type !== "pay")
    .map((s) => selectedByRow.get(s.rowIndex))
    .filter((r): r is PaymentIntentRecord => r !== undefined && r.resolvedAddress !== undefined)
    .map((r) => ({
      rowIndex: r.rowIndex,
      type: r.type,
      to: r.resolvedAddress as Address,
      amount: r.amount,
      ...(r.scheduleSpec !== undefined ? { scheduleSpec: r.scheduleSpec } : {}),
    }));

  return { payChunks, singles };
}

// ---------------------------------------------------------------------------
// Approve / confirm / resume / cancel
// ---------------------------------------------------------------------------

export interface ApproveInput {
  allowDuplicateRows?: boolean;
  rowOverrides?: Array<{ rowIndex: number; action: "remove" | "keep" }>;
}

export interface ApproveResult {
  job: CsvImportJob;
  /** Present only for the user-signed path. */
  plan?: ExecutionPlan;
}

export function approveJob(jobId: string, input: ApproveInput): ApproveResult {
  const job = getJob(jobId);
  if (job === undefined) throw new Error("Job not found.");
  if (!["previewed", "awaiting_approval", "partially_completed"].includes(job.status)) {
    throw new Error(`Job cannot be approved from status "${job.status}".`);
  }

  if (input.rowOverrides !== undefined) {
    for (const override of input.rowOverrides) {
      if (override.action === "remove") {
        updateIntent(jobId, override.rowIndex, {
          status: "blocked",
          policyStatus: "blocked",
          blockReason: "Removed by reviewer before execution.",
        });
      }
      // "keep" is a no-op marker: the row already executes if policy-valid; a
      // blocking duplicate is gated by allowDuplicateRows below.
    }
  }

  const allowDuplicateRows = input.allowDuplicateRows ?? job.allowDuplicateRows;
  const updated = updateJob(jobId, { allowDuplicateRows, status: "executing" }) as CsvImportJob;
  recountJob(jobId);

  if (updated.source === "user") {
    return { job: getJob(jobId) as CsvImportJob, plan: buildUserPlan(updated) };
  }
  // Autopilot: the executor loop picks the job up on its next tick.
  return { job: getJob(jobId) as CsvImportJob };
}

export interface ConfirmRowsInput {
  rowIndexes: number[];
  userOpHash?: Hex;
  txHash?: Hex;
  receiptType?: "BATCH_PAYMENT" | "SINGLE_PAYMENT" | "PAYMENT_REQUEST_SETTLED" | "SUBSCRIPTION_PAYMENT";
  /** The op was included on-chain but its execution reverted (no funds moved). */
  failed?: boolean;
}

/**
 * Record user-signed execution results. The app submits with the user's wallet
 * (the service holds no user key) and reports back here. Idempotent: a row whose
 * intentKey is already confirmed is left untouched, so re-reporting never
 * double-writes a receipt.
 */
export async function confirmUserRows(jobId: string, input: ConfirmRowsInput): Promise<CsvImportJob> {
  const job = getJob(jobId);
  if (job === undefined) throw new Error("Job not found.");
  if (job.source !== "user") throw new Error("confirm is only for user-signed jobs.");

  for (const rowIndex of input.rowIndexes) {
    const intent = intentsForJob(jobId).find((i) => i.rowIndex === rowIndex);
    if (intent === undefined || intent.status === "confirmed") continue;

    if (input.failed === true) {
      // The userOp was mined but its inner call reverted — no payment settled.
      // Record the failure honestly; never mark it confirmed or write a receipt.
      updateIntent(jobId, rowIndex, {
        status: "failed",
        blockReason: "On-chain execution reverted; no funds moved.",
        ...(input.userOpHash !== undefined ? { userOpHash: input.userOpHash } : {}),
      });
      continue;
    }

    if (input.txHash === undefined) {
      // Submission acknowledged but not yet mined: record the userOp so a resume
      // can reconcile it instead of re-submitting (avoids a double payment).
      updateIntent(jobId, rowIndex, {
        status: "executing",
        ...(input.userOpHash !== undefined ? { userOpHash: input.userOpHash } : {}),
      });
      continue;
    }

    updateIntent(jobId, rowIndex, {
      status: "confirmed",
      txHash: input.txHash,
      ...(input.userOpHash !== undefined ? { userOpHash: input.userOpHash } : {}),
    });
    // Only an actual payment settles into a receipt. Creating a payment request
    // or a subscription is not itself a payment — its receipts come later (the
    // subscription keeper issues one per charge).
    if (intent.type === "pay") {
      await writeReceiptForRow(jobId, rowIndex, input.receiptType ?? "BATCH_PAYMENT");
    }
  }

  recountJob(jobId);
  return finalizeJobStatus(jobId);
}

export async function resumeJob(jobId: string): Promise<ApproveResult> {
  const job = getJob(jobId);
  if (job === undefined) throw new Error("Job not found.");
  if (job.status === "cancelled" || job.status === "completed") {
    return { job };
  }
  const client = getClient();
  await reconcileExecutingRows(jobId, client);

  updateJob(jobId, { status: "executing" });
  const refreshed = getJob(jobId) as CsvImportJob;
  if (refreshed.source === "user") {
    return { job: refreshed, plan: buildUserPlan(refreshed) };
  }
  return { job: refreshed };
}

export function cancelJob(jobId: string): CsvImportJob {
  const job = getJob(jobId);
  if (job === undefined) throw new Error("Job not found.");
  if (["completed", "cancelled"].includes(job.status)) return job;
  // Confirmed rows stay confirmed; everything else stops being eligible.
  return updateJob(jobId, { status: "cancelled" }) as CsvImportJob;
}

export function getJobView(jobId: string): { job: CsvImportJob; intents: PaymentIntentRecord[] } | undefined {
  const job = getJob(jobId);
  if (job === undefined) return undefined;
  return { job, intents: intentsForJob(jobId) };
}

// ---------------------------------------------------------------------------
// Receipts + reconciliation + finalize
// ---------------------------------------------------------------------------

async function writeReceiptForRow(
  jobId: string,
  rowIndex: number,
  receiptType: "BATCH_PAYMENT" | "SINGLE_PAYMENT" | "PAYMENT_REQUEST_SETTLED" | "SUBSCRIPTION_PAYMENT",
): Promise<void> {
  const intent = intentsForJob(jobId).find((i) => i.rowIndex === rowIndex);
  if (intent === undefined || intent.resolvedAddress === undefined || intent.txHash === undefined) return;
  const job = getJob(jobId);
  if (job === undefined) return;
  try {
    const receipt = await issueReceipt({
      payer: job.smartAccount,
      payee: intent.resolvedAddress,
      token: CONTRACTS.qusdc,
      amount: formatQusdc(BigInt(intent.amount)),
      amountPrivate: false,
      metadataHash: hashReceiptMetadata({
        source: "csv-import",
        jobId,
        rowIndex,
        intentKey: intent.intentKey,
        contentKey: intent.contentKey ?? null,
        userOpHash: intent.userOpHash ?? null,
        txHash: intent.txHash,
      }),
      receiptType,
      paymentReference: intent.txHash,
    });
    updateIntent(jobId, rowIndex, { receiptId: receipt.receiptId });
  } catch (e) {
    console.error(`[csv-import] receipt failed job=${jobId} row=${rowIndex}:`, e);
  }
}

/** Reconcile rows left "executing" (submitted, not yet confirmed) by userOp receipt. */
async function reconcileExecutingRows(
  jobId: string,
  client: ReturnType<typeof createQevieClient>,
): Promise<void> {
  for (const intent of intentsForJob(jobId)) {
    if (intent.status !== "executing") continue;
    if (intent.userOpHash === undefined) {
      // Submitted-without-record (app died before reporting): make retryable.
      updateIntent(jobId, intent.rowIndex, { status: "valid" });
      continue;
    }
    try {
      const receipt = await client.bundler.getUserOperationReceipt(intent.userOpHash);
      if (receipt === null || receipt.status === "pending") continue;
      if (receipt.status === "mined" && receipt.txHash !== null) {
        updateIntent(jobId, intent.rowIndex, { status: "confirmed", txHash: receipt.txHash });
        const rType = intent.type === "subscription"
          ? "SUBSCRIPTION_PAYMENT"
          : intent.type === "request"
            ? "PAYMENT_REQUEST_SETTLED"
            : "SINGLE_PAYMENT";
        await writeReceiptForRow(jobId, intent.rowIndex, rType);
      } else if (receipt.status === "failed") {
        updateIntent(jobId, intent.rowIndex, { status: "failed" });
      }
    } catch (e) {
      console.error(`[csv-import] reconcile failed job=${jobId} row=${intent.rowIndex}:`, e);
    }
  }
}

/** Move the job to completed / partially_completed based on row outcomes. */
function finalizeJobStatus(jobId: string): CsvImportJob {
  const rows = intentsForJob(jobId);
  const job = getJob(jobId) as CsvImportJob;
  if (job.status === "cancelled") return job;

  const executable = rows.filter(
    (r) => r.status === "valid" || r.status === "executing" || r.status === "failed",
  );
  const anyConfirmed = rows.some((r) => r.status === "confirmed");

  if (executable.length === 0) {
    return updateJob(jobId, { status: "completed" }) as CsvImportJob;
  }
  const stillRunning = rows.some((r) => r.status === "valid" || r.status === "executing");
  if (!stillRunning && anyConfirmed) {
    return updateJob(jobId, { status: "partially_completed" }) as CsvImportJob;
  }
  return job;
}

function formatQusdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole.toString()}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Autopilot executor loop (session-signed; user path is executed app-side)
// ---------------------------------------------------------------------------

const processing = new Set<string>();

async function resolveSessionGas(
  client: ReturnType<typeof createQevieClient>,
  policyId: Hex,
  smartAccount: Address,
): Promise<{ mode: GasMode; allowlistToken?: AllowlistToken } | null> {
  let decisionMode: string;
  try {
    decisionMode = (await client.agent.getAutopilotGasStatus(policyId)).mode;
  } catch {
    return { mode: "qusdc" };
  }
  const mode = toBuilderGasMode(decisionMode as Parameters<typeof toBuilderGasMode>[0]);
  if (mode === null) return null; // PAUSED
  if (mode === "sponsored") {
    const token = await issueAllowlistToken(smartAccount);
    if (token !== null) return { mode: "sponsored", allowlistToken: token };
    return { mode: "qusdc" };
  }
  return { mode };
}

async function executeAutopilotJob(
  job: CsvImportJob,
  client: ReturnType<typeof createQevieClient>,
): Promise<void> {
  if (job.policyId === undefined) return;
  await reconcileExecutingRows(job.jobId, client);

  const policy = await client.agent.getSessionPolicy(job.policyId);
  if (!policy.active || policy.guardianRevoked) {
    updateJob(job.jobId, { status: "failed", error: "Policy is inactive or revoked." });
    return;
  }
  const privateKey = getSessionPrivateKey(policy.sessionKey);
  if (privateKey === null) {
    updateJob(job.jobId, { status: "failed", error: "Policy session key is not custodied by this service." });
    return;
  }

  const intents = intentsForJob(job.jobId);
  const confirmed = intents.filter((i) => i.status === "confirmed").map((i) => i.intentKey);
  const selected = selectExecutableRows(intents.map(toSelectable), {
    allowDuplicateRows: job.allowDuplicateRows,
    isAutopilot: true,
    confirmedIntentKeys: confirmed,
  }).filter((s) => s.type === "pay");

  const byRow = new Map(intents.map((i) => [i.rowIndex, i]));
  const signer = sessionSignerFromKey(privateKey);

  for (const sel of selected) {
    const intent = byRow.get(sel.rowIndex);
    if (intent === undefined || intent.resolvedAddress === undefined) continue;
    const amount = BigInt(intent.amount);
    if (amount > policy.maxPerTx) {
      updateIntent(job.jobId, sel.rowIndex, { status: "failed", blockReason: "Amount exceeds policy max-per-tx." });
      continue;
    }

    const gas = await resolveSessionGas(client, job.policyId, job.smartAccount);
    if (gas === null) {
      console.log(`[csv-import] job ${job.jobId} row ${sel.rowIndex} paused — no gas route`);
      continue; // leave valid; retry next tick
    }

    updateIntent(job.jobId, sel.rowIndex, { status: "executing" });
    let result: UserOpResult;
    try {
      result = await client.agent.executeAutopilotPayment(
        signer,
        {
          smartAccount: job.smartAccount,
          policyId: job.policyId,
          recipient: intent.resolvedAddress,
          amount,
          mode: gas.mode,
        },
        gas.allowlistToken,
      );
    } catch (e) {
      // The op may already be in flight; stop this row rather than risk a double
      // pay. A reconcile pass or resume will settle it.
      updateIntent(job.jobId, sel.rowIndex, {
        status: "failed",
        blockReason: `Submission error: ${e instanceof Error ? e.message : "unknown"}`,
      });
      console.error(`[csv-import] job ${job.jobId} row ${sel.rowIndex} submit error:`, e);
      continue;
    }

    if (result.status === "mined" && result.txHash !== null) {
      updateIntent(job.jobId, sel.rowIndex, {
        status: "confirmed",
        userOpHash: result.userOpHash,
        txHash: result.txHash,
      });
      await writeReceiptForRow(job.jobId, sel.rowIndex, "SINGLE_PAYMENT");
    } else {
      // Submitted but not confirmed: keep as executing with the userOp so the
      // reconcile pass settles it — never auto-retried.
      updateIntent(job.jobId, sel.rowIndex, {
        status: "executing",
        userOpHash: result.userOpHash,
      });
    }
  }

  recountJob(job.jobId);
  finalizeJobStatus(job.jobId);
}

export async function runCsvImportOnce(): Promise<void> {
  const jobs = jobsByStatus("executing").filter((j) => j.source === "autopilot");
  if (jobs.length === 0) return;
  const client = getClient();
  for (const job of jobs) {
    if (processing.has(job.jobId)) continue;
    processing.add(job.jobId);
    try {
      await executeAutopilotJob(job, client);
    } catch (e) {
      console.error(`[csv-import] error executing job ${job.jobId}:`, e);
    } finally {
      processing.delete(job.jobId);
    }
  }
}

export function startCsvImportExecutor(): void {
  if (!CSV_IMPORT_EXECUTOR_ENABLED) {
    console.log("[csv-import] executor disabled (CSV_IMPORT_EXECUTOR_ENABLED=false)");
    return;
  }
  console.log(`[csv-import] executor starting with poll interval ${CSV_IMPORT_POLL_INTERVAL_MS}ms`);
  void runCsvImportOnce();
  setInterval(() => { void runCsvImportOnce(); }, CSV_IMPORT_POLL_INTERVAL_MS);
}
