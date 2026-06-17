/**
 * Natural-language agent intents.
 *
 * The parser turns a user instruction into one of these structured intents (or
 * a clarification request). Amounts are kept as human QUSDC strings ("5",
 * "8.50"); conversion to 6-decimal base units happens at execution time via the
 * existing SDK rails — the parser never executes anything.
 */

export type RecurrencePeriod = "day" | "week" | "month";

export interface SendIntent {
  kind: "send";
  recipientInput: string;
  /** Human QUSDC amount, e.g. "5" or "8.50". */
  amount: string;
  memo?: string;
}

export interface BatchPayment {
  recipientInput: string;
  amount: string;
}

export interface BatchIntent {
  kind: "batch";
  payments: BatchPayment[];
  memo?: string;
}

export interface PaymentLinkIntent {
  kind: "payment_link";
  amount?: string;
  memo?: string;
  /** Optional preset recipient (rare for links). */
  recipientInput?: string;
}

export interface PaymentRequestIntent {
  kind: "payment_request";
  /** Counterparty to bill; undefined = open request. */
  fromInput?: string;
  amount: string;
  memo?: string;
}

export interface SubscriptionIntent {
  kind: "subscription";
  recipientInput: string;
  amount: string;
  period: RecurrencePeriod;
  intervalSeconds: number;
  /** Number of charges; undefined = open-ended. */
  maxRuns?: number;
  /**
   * Unix timestamp (seconds) for the first charge, when the command anchors to a
   * specific day ("every friday" → the next Friday). Undefined = start now.
   */
  startAt?: number;
  memo?: string;
}

export interface MultiStepIntent {
  kind: "multi_step";
  rawInput: string;
  steps: SingleIntent[];
  warnings: string[];
}

/** Intents that are directly executable as a single tool action. */
export type SingleIntent =
  | SendIntent
  | BatchIntent
  | PaymentLinkIntent
  | PaymentRequestIntent
  | SubscriptionIntent;

export type AgentIntent = SingleIntent | MultiStepIntent;

/** Returned when the instruction is too ambiguous to execute safely. */
export interface ClarificationNeeded {
  kind: "clarification";
  rawInput: string;
  question: string;
  reason: string;
}

export type ParseResult = AgentIntent | ClarificationNeeded;

export const PERIOD_SECONDS: Record<RecurrencePeriod, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000, // 30 days
};
