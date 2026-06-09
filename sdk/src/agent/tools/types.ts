import type { Address, Hex } from "viem";
import type { GasMode, QevieSigner } from "../../types.js";
import type { QevieClient } from "../../client.js";

/**
 * Agent tool registry types.
 *
 * Tools are THIN wrappers over existing `QevieClient` rails — they add no new
 * execution logic, they just give agents a uniform, named surface to call the
 * same payment methods a human uses (send, batch, link, request, subscription,
 * receipt, passport). This keeps a single execution path and a single set of
 * on-chain safety guarantees.
 */

export type AgentToolName =
  | "send_qusdc"
  | "batch_pay_qusdc"
  | "create_payment_link"
  | "create_payment_request"
  | "create_subscription"
  | "create_receipt"
  | "read_passport";

export interface AgentToolContext {
  chainId: number;
  smartAccount: Address;
  policyId?: Hex;
  gasMode?: GasMode;
}

export type AgentToolStatus =
  | "prepared"
  | "submitted"
  | "executed"
  | "failed"
  | "blocked";

export interface AgentToolResult {
  tool: AgentToolName;
  status: AgentToolStatus;
  userOpHash?: Hex;
  txHash?: Hex;
  receiptId?: Hex;
  /** Non-execution outputs (e.g. a payment-link URL, passport JSON). */
  output?: unknown;
  reason?: string;
}

/**
 * A tool wraps one SDK rail. `execute` requires a signer (manual-approval or a
 * scoped session signer); read-only tools ignore it. Every tool delegates to an
 * existing `QevieClient` method — no duplicated execution logic.
 */
export interface AgentTool<I> {
  readonly name: AgentToolName;
  execute(
    client: QevieClient,
    signer: QevieSigner | null,
    input: I,
    ctx: AgentToolContext,
  ): Promise<AgentToolResult>;
}

export type { QevieSigner };
