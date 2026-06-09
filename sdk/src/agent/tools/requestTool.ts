import type { AgentTool, AgentToolResult } from "./types.js";

export interface RequestToolInput {
  from?: string;
  amount: bigint;
  memo?: string;
  expirySeconds?: number;
}

/** Wraps `client.requestPayment` — create a payable obligation rail. */
export const requestTool: AgentTool<RequestToolInput> = {
  name: "create_payment_request",
  async execute(client, signer, input): Promise<AgentToolResult> {
    if (signer === null) {
      return { tool: "create_payment_request", status: "blocked", reason: "A signer is required to create a request." };
    }
    const res = await client.requestPayment(signer, {
      ...(input.from !== undefined ? { from: input.from } : {}),
      amount: input.amount,
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
      ...(input.expirySeconds !== undefined ? { expirySeconds: input.expirySeconds } : {}),
    });
    return {
      tool: "create_payment_request",
      status: res.status === "mined" ? "executed" : res.status === "failed" ? "failed" : "submitted",
      userOpHash: res.userOpHash,
      ...(res.txHash !== null ? { txHash: res.txHash } : {}),
    };
  },
};
