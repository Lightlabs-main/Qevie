import type { AgentIntent, SingleIntent } from "../intent/types.js";
import { sendTool } from "./sendTool.js";
import { batchTool } from "./batchTool.js";
import { linkTool } from "./linkTool.js";
import { requestTool } from "./requestTool.js";
import { subscriptionTool } from "./subscriptionTool.js";
import { receiptTool } from "./receiptTool.js";
import { passportTool } from "./passportTool.js";
import type { AgentToolName } from "./types.js";

export * from "./types.js";
export { sendTool } from "./sendTool.js";
export type { SendToolInput } from "./sendTool.js";
export { batchTool } from "./batchTool.js";
export type { BatchToolInput } from "./batchTool.js";
export { linkTool } from "./linkTool.js";
export type { LinkToolInput } from "./linkTool.js";
export { requestTool } from "./requestTool.js";
export type { RequestToolInput } from "./requestTool.js";
export { subscriptionTool } from "./subscriptionTool.js";
export type { SubscriptionToolInput } from "./subscriptionTool.js";
export { receiptTool } from "./receiptTool.js";
export type { ReceiptToolInput } from "./receiptTool.js";
export { passportTool } from "./passportTool.js";
export type { PassportToolInput } from "./passportTool.js";

/** The full agent tool registry, keyed by tool name. */
export const AGENT_TOOLS = {
  send_qusdc: sendTool,
  batch_pay_qusdc: batchTool,
  create_payment_link: linkTool,
  create_payment_request: requestTool,
  create_subscription: subscriptionTool,
  create_receipt: receiptTool,
  read_passport: passportTool,
} as const;

const INTENT_TOOL: Record<SingleIntent["kind"], AgentToolName> = {
  send: "send_qusdc",
  batch: "batch_pay_qusdc",
  payment_link: "create_payment_link",
  payment_request: "create_payment_request",
  subscription: "create_subscription",
};

/** The tool name a single intent maps to. */
export function toolForIntent(intent: SingleIntent): AgentToolName {
  return INTENT_TOOL[intent.kind];
}

/**
 * The ordered list of tool names an intent would invoke (one for a single
 * intent, several for a multi-step intent). Used for preview/planning UI — no
 * execution.
 */
export function planToolsForIntent(intent: AgentIntent): AgentToolName[] {
  if (intent.kind === "multi_step") {
    return intent.steps.map(toolForIntent);
  }
  return [toolForIntent(intent)];
}
