import type {
  IntentType,
  PolicyMirror,
  PolicyPreviewResult,
  PolicyPreviewRow,
  PolicyPreviewStatus,
} from "./types.js";

/**
 * Advisory policy preview — a FAIL-FAST MIRROR of the on-chain AgentPolicy for
 * UX only. The AgentPolicyManager re-enforces every one of these at
 * `executeSession`, and the QIE bundler runs unsafe/no-trace, so this preview is
 * NEVER a security boundary: if it and the chain disagree, the chain wins.
 *
 * Hard violations (inactive/expired/not-yet-valid policy, rail not allowed,
 * recipient not allow-listed, amount > max-per-tx, would exceed the immutable
 * total limit) → `blocked`. Soft/timing concerns that the chain may clear by
 * execution time (daily/weekly window budget) → `needs_review`. Everything else
 * → `valid`.
 *
 * A limit of `0` is treated as "no limit" so a permissive policy is not
 * false-flagged; the chain remains the source of truth either way.
 */

function railAllowed(policy: PolicyMirror, type: IntentType): boolean {
  switch (type) {
    case "pay":
      return policy.allowSinglePayment;
    case "request":
      return policy.allowPaymentRequest;
    case "subscription":
      return policy.allowSubscription;
  }
}

function railLabel(type: IntentType): string {
  switch (type) {
    case "pay":
      return "single payments";
    case "request":
      return "payment requests";
    case "subscription":
      return "subscriptions";
  }
}

/** Remaining budget for a window, or null when the limit is "unlimited" (0). */
function remaining(limit: bigint, spent: bigint, accrued: bigint): bigint | null {
  if (limit === 0n) return null;
  const rem = limit - spent - accrued;
  return rem < 0n ? 0n : rem;
}

/**
 * Mirror the policy across a job's rows in order, accumulating spend so the
 * daily/weekly/total budget checks reflect the cumulative effect of the batch.
 * Rows are evaluated independently but share the running accumulators.
 */
export function previewPolicyForRows(
  policy: PolicyMirror,
  rows: PolicyPreviewRow[],
  nowSeconds: number,
): PolicyPreviewResult[] {
  const now = BigInt(Math.floor(nowSeconds));
  let accToday = 0n;
  let accWeek = 0n;
  let accTotal = 0n;

  const results: PolicyPreviewResult[] = [];
  for (const row of rows) {
    const reasons: string[] = [];
    let status: PolicyPreviewStatus = "valid";

    if (!policy.active || policy.guardianRevoked) {
      reasons.push("Policy is inactive or has been revoked by its guardian.");
      status = "blocked";
    }
    if (policy.validUntil !== 0n && policy.validUntil <= now) {
      reasons.push("Policy has expired.");
      status = "blocked";
    }
    if (policy.validAfter > now) {
      reasons.push("Policy is not active yet (validAfter is in the future).");
      status = "blocked";
    }
    if (!railAllowed(policy, row.type)) {
      reasons.push(`Policy does not allow ${railLabel(row.type)}.`);
      status = "blocked";
    }
    if (!row.recipientAllowed) {
      reasons.push("Recipient is not on the policy's on-chain allowlist.");
      status = "blocked";
    }
    if (policy.maxPerTx !== 0n && row.amount > policy.maxPerTx) {
      reasons.push("Amount exceeds the policy's max-per-tx limit.");
      status = "blocked";
    }

    const remTotal = remaining(policy.totalLimit, policy.spentTotal, accTotal);
    if (remTotal !== null && row.amount > remTotal) {
      reasons.push("Amount would exceed the policy's total spend limit.");
      status = "blocked";
    }

    // Daily/weekly windows can reset before execution; flag, don't hard-block.
    if (status !== "blocked") {
      const remDay = remaining(policy.dailyLimit, policy.spentToday, accToday);
      if (remDay !== null && row.amount > remDay) {
        reasons.push("Amount may exceed the remaining daily limit for this account.");
        status = "needs_review";
      }
      const remWeek = remaining(policy.weeklyLimit, policy.spentThisWeek, accWeek);
      if (remWeek !== null && row.amount > remWeek) {
        reasons.push("Amount may exceed the remaining weekly limit for this account.");
        status = "needs_review";
      }
    }

    // Non-blocked rows are assumed to (potentially) execute, so they consume
    // budget for the rows that follow.
    if (status !== "blocked") {
      accToday += row.amount;
      accWeek += row.amount;
      accTotal += row.amount;
    }

    results.push({ rowIndex: row.rowIndex, status, reasons });
  }
  return results;
}
