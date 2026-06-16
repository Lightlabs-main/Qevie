import type { Hex } from "viem";
import type {
  DedupeOptions,
  DedupeRow,
  DuplicateSeverity,
  DuplicateWarning,
  IntentType,
} from "./types.js";

/**
 * Off-chain Duplicate Sentry. Runs AFTER resolution (on snapshotted addresses)
 * so different inputs that resolve to the same address collapse correctly.
 *
 * Severity is rail-aware: a duplicate `pay`/`subscription` moves (or commits to
 * move) money → block by default. A duplicate `request` is an annoyance, not a
 * loss → soft warning, allowed. The pipeline, not this function, decides whether
 * a `block` actually stops execution (it does unless `allowDuplicateRows` and
 * not Autopilot).
 */

/** Money-moving rails are blocked on duplicate; requests are only warned. */
export function severityForType(type: IntentType): DuplicateSeverity {
  return type === "request" ? "warn" : "block";
}

function rankSeverity(s: DuplicateSeverity): number {
  return s === "block" ? 2 : 1;
}

/** Reduce a row's warnings to its single highest severity, or null. */
export function highestSeverity(warnings: DuplicateWarning[]): DuplicateSeverity | null {
  let best: DuplicateSeverity | null = null;
  for (const w of warnings) {
    if (best === null || rankSeverity(w.severity) > rankSeverity(best)) best = w.severity;
  }
  return best;
}

export function detectDuplicates(rows: DedupeRow[], options: DedupeOptions = {}): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = [];

  // ---- 1) Same-file: identical contentKey appears more than once ----------
  const byContent = new Map<Hex, DedupeRow[]>();
  for (const row of rows) {
    const list = byContent.get(row.contentKey) ?? [];
    list.push(row);
    byContent.set(row.contentKey, list);
  }
  for (const group of byContent.values()) {
    if (group.length < 2) continue;
    const indices = group.map((r) => r.rowIndex);
    for (const row of group) {
      warnings.push({
        rowIndex: row.rowIndex,
        check: "same_file",
        severity: severityForType(row.type),
        message: `Identical to ${describeOthers(row.rowIndex, indices)} in this file (same recipient, amount, memo).`,
        relatedRows: indices.filter((i) => i !== row.rowIndex),
      });
    }
  }

  // ---- 2) Same recipient + amount + type (memo differs) -------------------
  const byRecipientAmount = new Map<string, DedupeRow[]>();
  for (const row of rows) {
    const k = `${row.resolvedAddress}|${row.amount.toString()}|${row.type}`;
    const list = byRecipientAmount.get(k) ?? [];
    list.push(row);
    byRecipientAmount.set(k, list);
  }
  for (const group of byRecipientAmount.values()) {
    if (group.length < 2) continue;
    // Skip the subset already flagged as exact same-file duplicates: only warn
    // here when at least two rows differ by content (e.g. different memo).
    const distinctContent = new Set(group.map((r) => r.contentKey));
    if (distinctContent.size < 2) continue;
    const indices = group.map((r) => r.rowIndex);
    for (const row of group) {
      warnings.push({
        rowIndex: row.rowIndex,
        check: "same_recipient_amount",
        severity: severityForType(row.type),
        message: `Same resolved recipient + amount as ${describeOthers(row.rowIndex, indices)} (memo differs).`,
        relatedRows: indices.filter((i) => i !== row.rowIndex),
      });
    }
  }

  // ---- 3) Resolution collision: distinct inputs → same address ------------
  const byAddress = new Map<string, DedupeRow[]>();
  for (const row of rows) {
    const list = byAddress.get(row.resolvedAddress) ?? [];
    list.push(row);
    byAddress.set(row.resolvedAddress, list);
  }
  for (const group of byAddress.values()) {
    const inputs = new Set(group.map((r) => r.recipientInput.toLowerCase()));
    if (inputs.size < 2) continue; // same address but same input string → not a collision
    for (const row of group) {
      const others = group.filter(
        (r) => r.recipientInput.toLowerCase() !== row.recipientInput.toLowerCase(),
      );
      if (others.length === 0) continue;
      warnings.push({
        rowIndex: row.rowIndex,
        check: "resolution_collision",
        severity: "warn",
        message: `"${row.recipientInput}" resolves to the same address as ${describeOthers(
          row.rowIndex,
          others.map((r) => r.rowIndex),
        )} (different input, same recipient).`,
        relatedRows: others.map((r) => r.rowIndex),
      });
    }
  }

  // ---- 4) History: contentKey seen recently across receipts/pending/jobs ---
  const history = new Set<Hex>(options.historyContentKeys ?? []);
  if (history.size > 0) {
    for (const row of rows) {
      if (!history.has(row.contentKey)) continue;
      warnings.push({
        rowIndex: row.rowIndex,
        check: "history",
        severity: severityForType(row.type),
        message:
          row.type === "request"
            ? "An identical request was already created (or is pending) within the lookback window."
            : "An identical payment was already made (or is pending) within the lookback window.",
      });
    }
  }

  return warnings;
}

function describeOthers(self: number, indices: number[]): string {
  const others = indices.filter((i) => i !== self);
  const labels = others.map((i) => `row ${i + 1}`);
  if (labels.length === 0) return "another row";
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1] as string}`;
}
