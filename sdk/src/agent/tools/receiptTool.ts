import type { CreateReceiptInput } from "../../types.js";
import type { AgentTool, AgentToolResult } from "./types.js";

export type ReceiptToolInput = CreateReceiptInput;

/** Wraps `client.createReceipt` — write an audit-trail receipt rail. */
export const receiptTool: AgentTool<ReceiptToolInput> = {
  name: "create_receipt",
  async execute(client, _signer, input): Promise<AgentToolResult> {
    const res = await client.createReceipt(input);
    return {
      tool: "create_receipt",
      status: "executed",
      receiptId: res.receiptId,
      ...(res.txHash !== null ? { txHash: res.txHash } : {}),
    };
  },
};
