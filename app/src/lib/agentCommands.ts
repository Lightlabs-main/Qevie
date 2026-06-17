/**
 * Agent Commands glue: turn a natural-language instruction into a previewable
 * plan (selected rails + resolved recipients) WITHOUT executing anything.
 *
 * Execution stays in the existing manual rails (Send/Batch/Request/Subscription)
 * or in Autopilot — this module only parses, resolves recipients (so `.qie` is
 * verified before anything runs), and produces deep links into those rails. No
 * payment logic is duplicated here.
 */

import type { QevieClient } from "@qevie/sdk";
import {
  parseAgentCommand,
  planToolsForIntent,
  PERIOD_SECONDS,
  type AgentIntent,
  type AgentToolName,
  type ResolvedRecipient,
} from "@qevie/sdk";

export interface ResolvedLeg {
  input: string;
  resolved?: ResolvedRecipient;
  error?: string;
}

export interface CommandPlan {
  intent: AgentIntent;
  tools: AgentToolName[];
  legs: ResolvedLeg[];
  /** True when a required recipient could not be resolved (e.g. unresolved .qie). */
  blocked: boolean;
  blockReason?: string;
  /** Deep link into the matching manual rail, prefilled. */
  manualHref?: string;
  /** Deep link to create an Autopilot policy seeded from this command. */
  policyHref?: string;
  /** For payment_link intents: the generated shareable URL. */
  linkUrl?: string;
}

export type AgentCommandResult =
  | { kind: "clarification"; question: string }
  | { kind: "plan"; plan: CommandPlan };

function recipientInputs(intent: AgentIntent): string[] {
  switch (intent.kind) {
    case "send":
    case "subscription":
      return [intent.recipientInput];
    case "batch":
      return intent.payments.map((p) => p.recipientInput);
    case "payment_request":
      return intent.fromInput !== undefined ? [intent.fromInput] : [];
    case "payment_link":
      return intent.recipientInput !== undefined ? [intent.recipientInput] : [];
    case "multi_step":
      return intent.steps.flatMap(recipientInputs);
  }
}

/** Best target address for a deep link: the resolved address, else the raw input. */
function legTarget(legs: ResolvedLeg[], input: string): string {
  const leg = legs.find((l) => l.input === input);
  return leg?.resolved?.address ?? input;
}

function periodDays(period: "day" | "week" | "month"): number {
  return PERIOD_SECONDS[period] / 86_400;
}

export async function buildAgentCommand(
  client: QevieClient,
  appBaseUrl: string,
  input: string,
): Promise<AgentCommandResult> {
  const parsed = parseAgentCommand(input);
  if (parsed.kind === "clarification") {
    return { kind: "clarification", question: parsed.question };
  }

  const inputs = [...new Set(recipientInputs(parsed))];
  const legs: ResolvedLeg[] = await Promise.all(
    inputs.map(async (raw): Promise<ResolvedLeg> => {
      const r = await client.resolveDetailed(raw);
      return r.ok ? { input: raw, resolved: r } : { input: raw, error: r.message };
    }),
  );

  const failed = legs.filter((l) => l.resolved === undefined);
  const blocked = failed.length > 0;
  const blockReason = blocked
    ? failed.map((l) => `${l.input}: ${l.error ?? "unresolved"}`).join("; ")
    : undefined;

  const tools = planToolsForIntent(parsed);
  const plan: CommandPlan = { intent: parsed, tools, legs, blocked };
  if (blockReason !== undefined) plan.blockReason = blockReason;

  // Build a deep link into the right manual rail (skip when blocked).
  if (!blocked) {
    switch (parsed.kind) {
      case "send": {
        const to = legTarget(legs, parsed.recipientInput);
        const q = new URLSearchParams({ to, amount: parsed.amount });
        if (parsed.memo !== undefined) q.set("memo", parsed.memo);
        plan.manualHref = `/send?${q.toString()}`;
        break;
      }
      case "batch": {
        const q = new URLSearchParams();
        for (const p of parsed.payments) {
          q.append("r", `${legTarget(legs, p.recipientInput)}:${p.amount}`);
        }
        if (parsed.memo !== undefined) q.set("memo", parsed.memo);
        plan.manualHref = `/batch?${q.toString()}`;
        break;
      }
      case "payment_request": {
        const q = new URLSearchParams({ amount: parsed.amount });
        if (parsed.fromInput !== undefined) q.set("from", legTarget(legs, parsed.fromInput));
        if (parsed.memo !== undefined) q.set("memo", parsed.memo);
        plan.manualHref = `/request?${q.toString()}`;
        break;
      }
      case "subscription": {
        const q = new URLSearchParams({
          payee: legTarget(legs, parsed.recipientInput),
          amount: parsed.amount,
          periodDays: String(periodDays(parsed.period)),
        });
        if (parsed.maxRuns !== undefined) q.set("maxPayments", String(parsed.maxRuns));
        if (parsed.startAt !== undefined) q.set("startAt", String(parsed.startAt));
        plan.manualHref = `/subscriptions?${q.toString()}`;
        plan.policyHref = "/autopilot/new";
        break;
      }
      case "payment_link": {
        const to = parsed.recipientInput !== undefined
          ? legTarget(legs, parsed.recipientInput)
          : "";
        plan.linkUrl = client.createPaymentLink(appBaseUrl, {
          to,
          ...(parsed.amount !== undefined
            ? { amount: BigInt(Math.round(parseFloat(parsed.amount) * 1e6)) }
            : {}),
          ...(parsed.memo !== undefined ? { memo: parsed.memo } : {}),
        });
        plan.manualHref = "/links";
        break;
      }
      case "multi_step":
        plan.manualHref = "/rails";
        break;
    }
  }

  return { kind: "plan", plan };
}
