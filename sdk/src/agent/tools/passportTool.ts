import type { Address } from "viem";
import type { AgentTool, AgentToolResult } from "./types.js";

export interface PassportToolInput {
  account: Address;
}

/** Wraps `client.passport.getPassport` — read-only Passport rail. */
export const passportTool: AgentTool<PassportToolInput> = {
  name: "read_passport",
  async execute(client, _signer, input): Promise<AgentToolResult> {
    const stats = await client.passport.getPassport(input.account);
    return { tool: "read_passport", status: "executed", output: stats };
  },
};
