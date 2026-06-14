import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Hex,
} from "viem";
import type { SelectableIntent } from "./types.js";

/** BatchPayments.MAX_RECIPIENTS — a chunk may never exceed this on-chain cap. */
export const MAX_BATCH_RECIPIENTS = 200;
/** Default chunk size for user-path batchPay (kept well under the cap). */
export const DEFAULT_BATCH_CHUNK_SIZE = 100;

/**
 * Deterministic batch id: keccak256(jobId, chunkIndex). Replaces the
 * timestamp-derived id for CSV batches so a resubmitted chunk produces the same
 * id, which keeps `BatchPaid` events dedupable.
 *
 * NOTE: BatchPayments treats `batchId` as event-only metadata — it does NOT
 * revert or no-op on a repeat — so this id is observability, not a crash guard.
 * At-most-once execution is enforced off-chain by skipping confirmed intentKeys.
 */
export function deterministicBatchId(jobId: string, chunkIndex: number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string jobId, uint256 chunkIndex"), [
      jobId,
      BigInt(chunkIndex),
    ]),
  );
}

/** Split items into chunks of at most `size` (clamped to the on-chain cap). */
export function chunk<T>(items: T[], size: number = DEFAULT_BATCH_CHUNK_SIZE): T[][] {
  const limit = Math.max(1, Math.min(size, MAX_BATCH_RECIPIENTS));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(items.slice(i, i + limit));
  }
  return out;
}

export interface SelectOptions {
  /** User opted in to executing soft/blocked duplicate rows (ignored for Autopilot). */
  allowDuplicateRows: boolean;
  /** Autopilot jobs ALWAYS block duplicates — no override. */
  isAutopilot: boolean;
  /** intentKeys already confirmed on-chain — never re-submitted (idempotency). */
  confirmedIntentKeys?: Iterable<Hex>;
}

/**
 * The single gate that makes the executor idempotent AND duplicate-safe. Returns
 * the rows eligible to execute, in input order. A row is eligible iff:
 *   - its intentKey is NOT already confirmed (resume-safety), and
 *   - it is policy-`valid` (not `needs_review`/`blocked`), and
 *   - its lifecycle status is `valid` or `failed` (a failed row may be retried;
 *     `executing`/`confirmed` are never re-submitted), and
 *   - it is not a blocking duplicate — unless the user explicitly allowed
 *     duplicates AND this is not an Autopilot job. `warn`-level duplicates are
 *     always allowed.
 */
export function selectExecutableRows(
  intents: SelectableIntent[],
  options: SelectOptions,
): SelectableIntent[] {
  const confirmed = new Set<Hex>(options.confirmedIntentKeys ?? []);
  return intents.filter((intent) => {
    if (confirmed.has(intent.intentKey)) return false;
    if (intent.status === "confirmed" || intent.status === "executing") return false;
    if (intent.status !== "valid" && intent.status !== "failed") return false;
    if (intent.policyStatus !== "valid") return false;

    if (intent.duplicateSeverity === "block") {
      if (options.isAutopilot) return false;
      if (!options.allowDuplicateRows) return false;
    }
    return true;
  });
}
