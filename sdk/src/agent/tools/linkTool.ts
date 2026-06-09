import type { AgentTool, AgentToolResult } from "./types.js";

export interface LinkToolInput {
  appBaseUrl: string;
  to: string;
  amount?: bigint;
  memo?: string;
  expirySeconds?: number;
  maxUses?: number;
}

/**
 * Wraps `client.createPaymentLink` — generates a shareable payment request URL.
 * This is a prepare-only rail (no on-chain op); the link is returned in `output`.
 */
export const linkTool: AgentTool<LinkToolInput> = {
  name: "create_payment_link",
  async execute(client, _signer, input): Promise<AgentToolResult> {
    const url = client.createPaymentLink(input.appBaseUrl, {
      to: input.to,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
      ...(input.expirySeconds !== undefined ? { expirySeconds: input.expirySeconds } : {}),
      ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
    });
    return { tool: "create_payment_link", status: "prepared", output: url };
  },
};
