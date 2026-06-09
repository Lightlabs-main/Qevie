/**
 * Structural validation for parsed intents. This is a safety net BEFORE any
 * resolution or execution: it rejects nonsensical amounts and empty recipients
 * so a malformed parse never reaches a rail. Policy enforcement (caps, allowed
 * recipients, expiry) remains the on-chain AgentPolicyManager's job.
 */

import type { AgentIntent, ParseResult, SingleIntent } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

function isPositiveAmount(amount: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return false;
  return Number(amount) > 0;
}

function validateSingle(intent: SingleIntent, issues: string[]): void {
  switch (intent.kind) {
    case "send":
      if (intent.recipientInput.trim() === "") issues.push("Missing recipient.");
      if (!isPositiveAmount(intent.amount)) issues.push("Amount must be greater than zero.");
      break;
    case "batch":
      if (intent.payments.length === 0) issues.push("Batch has no recipients.");
      intent.payments.forEach((p, i) => {
        if (p.recipientInput.trim() === "") issues.push(`Recipient ${i + 1} is missing.`);
        if (!isPositiveAmount(p.amount)) issues.push(`Amount for recipient ${i + 1} is invalid.`);
      });
      break;
    case "payment_request":
      if (!isPositiveAmount(intent.amount)) issues.push("Request amount must be greater than zero.");
      break;
    case "payment_link":
      if (intent.amount !== undefined && !isPositiveAmount(intent.amount)) {
        issues.push("Payment-link amount must be greater than zero.");
      }
      break;
    case "subscription":
      if (intent.recipientInput.trim() === "") issues.push("Missing subscription recipient.");
      if (!isPositiveAmount(intent.amount)) issues.push("Subscription amount must be greater than zero.");
      if (intent.intervalSeconds <= 0) issues.push("Subscription interval is invalid.");
      if (intent.maxRuns !== undefined && intent.maxRuns < 1) issues.push("Subscription run count must be at least 1.");
      break;
  }
}

export function validateIntent(intent: AgentIntent): ValidationResult {
  const issues: string[] = [];
  if (intent.kind === "multi_step") {
    if (intent.steps.length === 0) issues.push("No steps to execute.");
    intent.steps.forEach((step) => validateSingle(step, issues));
  } else {
    validateSingle(intent, issues);
  }
  return { ok: issues.length === 0, issues };
}

/** True when a parse result is a directly-actionable intent (not a clarification). */
export function isActionable(result: ParseResult): result is AgentIntent {
  return result.kind !== "clarification";
}
