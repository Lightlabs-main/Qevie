import type { GasMode } from "../../types.js";
import type { AgentTool, AgentToolResult } from "./types.js";

export interface SendToolInput {
  to: string;
  amount: bigint;
  memo?: string;
  mode?: GasMode;
}

/** Wraps `client.pay` — a single one-off QUSDC transfer rail. */
export const sendTool: AgentTool<SendToolInput> = {
  name: "send_qusdc",
  async execute(client, signer, input, ctx): Promise<AgentToolResult> {
    if (signer === null) {
      return { tool: "send_qusdc", status: "blocked", reason: "A signer is required to send." };
    }
    const res = await client.pay(signer, {
      to: input.to,
      amount: input.amount,
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
      mode: input.mode ?? ctx.gasMode ?? "qusdc",
    });
    return {
      tool: "send_qusdc",
      status: res.status === "mined" ? "executed" : res.status === "failed" ? "failed" : "submitted",
      userOpHash: res.userOpHash,
      ...(res.txHash !== null ? { txHash: res.txHash } : {}),
    };
  },
};
