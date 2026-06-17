/**
 * Heuristic natural-language intent parser for agent-native commands.
 *
 * Pure + synchronous: it converts an instruction into a structured intent (or a
 * clarification request). It NEVER resolves recipients or executes anything —
 * resolution and execution happen downstream through the existing SDK rails and
 * the AgentPolicyManager. Ambiguous input returns a `clarification` instead of a
 * guessed action.
 */

import {
  PERIOD_SECONDS,
  type BatchPayment,
  type ParseResult,
  type RecurrencePeriod,
  type SingleIntent,
} from "./types.js";

const AMOUNT = String.raw`\$?(\d+(?:\.\d+)?)\s*(?:qusdc|usdc|\$)?`;
const RECIP = String.raw`(0x[0-9a-fA-F]{40}|[a-z0-9][a-z0-9_-]*\.qie|@?[a-z0-9_][a-z0-9_.-]{0,30})`;

const DAY_NAMES = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Unix timestamp (seconds) of the NEXT occurrence of a named weekday, preserving
 * the current time of day. Always a future time — if today is the named day, it
 * resolves to that day next week, so "pay every friday" never anchors to a date
 * in the past (the contract would otherwise charge immediately on creation).
 */
function nextWeekdayStart(dayName: string, now: Date = new Date()): number | null {
  const target = WEEKDAY_INDEX[dayName.toLowerCase()];
  if (target === undefined) return null;
  const delta = (target - now.getDay() + 7) % 7 || 7;
  const d = new Date(now);
  d.setDate(d.getDate() + delta);
  return Math.floor(d.getTime() / 1000);
}

function cleanRecipient(raw: string): string {
  return raw.trim().replace(/^@/, "").replace(/[.,!?]+$/, "");
}

function cleanMemo(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim().replace(/[.,!?]+$/, "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Map a recurrence keyword ("week", "friday", "monthly") to a period. */
function toPeriod(word: string): RecurrencePeriod | null {
  const w = word.toLowerCase();
  if (w.startsWith("day") || w === "daily") return "day";
  if (w.startsWith("week") || w === "weekly" || DAY_NAMES.has(w)) return "week";
  if (w.startsWith("month") || w === "monthly") return "month";
  return null;
}

function pair(recipient: string | undefined, amount: string | undefined): BatchPayment | null {
  if (recipient === undefined || amount === undefined) return null;
  return { recipientInput: cleanRecipient(recipient), amount };
}

/** Parse one "pay" clause into a recipient + amount pair, or null. */
function parsePair(clause: string): BatchPayment | null {
  const c = clause.trim().replace(/^(?:pay|send|to)\s+/i, "").trim();

  // "<amount> to <recip>"
  let m = c.match(new RegExp(`^${AMOUNT}\\s+to\\s+${RECIP}`, "i"));
  if (m) return pair(m[2], m[1]);

  // "<recip> <amount>"
  m = c.match(new RegExp(`^${RECIP}\\s+${AMOUNT}`, "i"));
  if (m) return pair(m[1], m[2]);

  // "<amount> <recip>" (amount-first without "to")
  m = c.match(new RegExp(`^${AMOUNT}\\s+${RECIP}`, "i"));
  if (m) return pair(m[2], m[1]);

  return null;
}

export function parseAgentCommand(input: string): ParseResult {
  const raw = input.trim();
  const rawInput = raw;
  if (raw === "") {
    return {
      kind: "clarification",
      rawInput,
      reason: "empty_input",
      question: "What would you like Qevie to do?",
    };
  }
  const lower = raw.toLowerCase();

  // 1. Payment request: "request <amount> from <recip> [for <memo>]".
  const reqMatch = raw.match(
    new RegExp(`request\\s+${AMOUNT}\\s+from\\s+${RECIP}(?:\\s+for\\s+(.+))?`, "i"),
  );
  if (reqMatch && reqMatch[1] !== undefined && reqMatch[2] !== undefined) {
    const memo = cleanMemo(reqMatch[3]);
    return {
      kind: "payment_request",
      fromInput: cleanRecipient(reqMatch[2]),
      amount: reqMatch[1],
      ...(memo !== undefined ? { memo } : {}),
    };
  }

  // 2. Payment link: "[create a] payment link for <amount> [for <memo>]".
  const linkMatch = raw.match(
    new RegExp(`payment\\s+link\\s+for\\s+${AMOUNT}(?:\\s+for\\s+(.+))?`, "i"),
  );
  if (linkMatch && linkMatch[1] !== undefined) {
    const memo = cleanMemo(linkMatch[2]);
    return {
      kind: "payment_link",
      amount: linkMatch[1],
      ...(memo !== undefined ? { memo } : {}),
    };
  }

  // 3. Subscription: "pay <recip> <amount> ... every <period> [for <n> <unit>s]".
  if (/\bevery\b/i.test(lower)) {
    const subMatch = raw.match(
      new RegExp(
        `(?:pay|send)\\s+${RECIP}\\s+${AMOUNT}.*?\\bevery\\s+(\\w+)`,
        "i",
      ),
    );
    if (subMatch && subMatch[1] !== undefined && subMatch[2] !== undefined && subMatch[3] !== undefined) {
      const period = toPeriod(subMatch[3]);
      if (period === null) {
        return {
          kind: "clarification",
          rawInput,
          reason: "unknown_period",
          question: `How often should this repeat? Try "every day", "every week", or "every month".`,
        };
      }
      const forMatch = lower.match(/for\s+(\d+)\s+(day|week|month|time)s?/);
      // "every <weekday>" anchors the first charge to that weekday; otherwise the
      // first charge defaults to now (startAt left undefined).
      const startAt = nextWeekdayStart(subMatch[3]);
      const intent: SingleIntent = {
        kind: "subscription",
        recipientInput: cleanRecipient(subMatch[1]),
        amount: subMatch[2],
        period,
        intervalSeconds: PERIOD_SECONDS[period],
        ...(forMatch ? { maxRuns: Number(forMatch[1]) } : {}),
        ...(startAt !== null ? { startAt } : {}),
      };
      return intent;
    }
  }

  // 4. Batch with an unspecified group: "batch pay <group> <amount> each".
  const eachMatch = lower.match(new RegExp(`${AMOUNT}\\s+each`, "i"));
  if (/\bbatch\b/i.test(lower) || eachMatch) {
    const pairs = extractPairs(raw);
    if (pairs.length >= 2) {
      return { kind: "batch", payments: pairs };
    }
    return {
      kind: "clarification",
      rawInput,
      reason: "missing_recipients",
      question:
        "Who should receive the batch payment? List the recipients (addresses, usernames, or name.qie) and the amount for each.",
    };
  }

  // 5. Multiple "pay A x and B y" clauses → batch.
  const pairs = extractPairs(raw);
  if (pairs.length >= 2) {
    return { kind: "batch", payments: pairs };
  }

  // 6. Single send/pay.
  if (/\b(pay|send)\b/i.test(lower) || pairs.length === 1) {
    const pair = pairs[0] ?? parsePair(raw);
    if (pair !== null) {
      const memoMatch = raw.match(/\bfor\s+(.+)$/i);
      const memo = cleanMemo(memoMatch?.[1]);
      return {
        kind: "send",
        recipientInput: pair.recipientInput,
        amount: pair.amount,
        ...(memo !== undefined ? { memo } : {}),
      };
    }
  }

  return {
    kind: "clarification",
    rawInput,
    reason: "unrecognized",
    question:
      'I could not turn that into a payment. Try "Pay alice 5 QUSDC" or "Request 10 QUSDC from bob".',
  };
}

/** Find all recipient+amount pairs across "and"/comma-separated pay clauses. */
function extractPairs(input: string): BatchPayment[] {
  const stripped = input.replace(/^(?:batch\s+)?(?:pay|send)\s+/i, "");
  const clauses = stripped.split(/\s*(?:,|\band\b)\s*/i);
  const pairs: BatchPayment[] = [];
  for (const clause of clauses) {
    const pair = parsePair(clause);
    if (pair !== null) pairs.push(pair);
  }
  return pairs;
}
