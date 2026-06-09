import type { GasMode } from "../../types.js";
import type { AgentTool, AgentToolResult } from "./types.js";

export interface BatchToolInput {
  recipients: Array<{ to: string; amount: bigint }>;
  memo?: string;
  mode?: GasMode;
}

/** Wraps `client.batchPay` — multi-recipient QUSDC execution rail. */
export const batchTool: AgentTool<BatchToolInput> = {
  name: "batch_pay_qusdc",
  async execute(client, signer, input, ctx): Promise<AgentToolResult> {
    if (signer === null) {
      return { tool: "batch_pay_qusdc", status: "blocked", reason: "A signer is required for batch pay." };
    }
    const res = await client.batchPay(signer, {
      recipients: input.recipients,
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
      mode: input.mode ?? ctx.gasMode ?? "qusdc",
    });
    return {
      tool: "batch_pay_qusdc",
      status: res.status === "mined" ? "executed" : res.status === "failed" ? "failed" : "submitted",
      userOpHash: res.userOpHash,
      ...(res.txHash !== null ? { txHash: res.txHash } : {}),
    };
  },
};
