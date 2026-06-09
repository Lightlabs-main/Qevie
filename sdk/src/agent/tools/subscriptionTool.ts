import type { GasMode } from "../../types.js";
import type { AgentTool, AgentToolResult } from "./types.js";

export interface SubscriptionToolInput {
  payee: string;
  amount: bigint;
  /** Period in seconds (minimum 86400). */
  period: number;
  maxPayments: number;
  startAt?: number;
  mode?: GasMode;
}

/** Wraps `client.subscribe` — create a recurring obligation rail. */
export const subscriptionTool: AgentTool<SubscriptionToolInput> = {
  name: "create_subscription",
  async execute(client, signer, input, ctx): Promise<AgentToolResult> {
    if (signer === null) {
      return { tool: "create_subscription", status: "blocked", reason: "A signer is required to subscribe." };
    }
    const res = await client.subscribe(signer, {
      payee: input.payee,
      amount: input.amount,
      period: input.period,
      maxPayments: input.maxPayments,
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      mode: input.mode ?? ctx.gasMode ?? "qusdc",
    });
    return {
      tool: "create_subscription",
      status: res.status === "mined" ? "executed" : res.status === "failed" ? "failed" : "submitted",
      userOpHash: res.userOpHash,
      ...(res.txHash !== null ? { txHash: res.txHash } : {}),
    };
  },
};
