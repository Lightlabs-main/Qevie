import type { Address } from "viem";
import { PAYMASTER_ABI } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

export interface AutopilotGasStatus {
  sponsoredRemaining: number;
  sponsoredUsed: number;
  qusdcGasConfigured: boolean;
  policyManagerConfigured: boolean;
  status: "active" | "paused";
  reason: string;
}

interface AutopilotClient {
  publicClient: {
    readContract(args: unknown): Promise<unknown>;
  };
}

export async function getAutopilotGasStatus(
  client: AutopilotClient,
  smartAccount: Address,
): Promise<AutopilotGasStatus> {
  let sponsoredRemaining: number;
  try {
    sponsoredRemaining = Number(await client.publicClient.readContract({
      address: APP_CONFIG.contracts.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "remainingFreeOps",
      args: [smartAccount],
    }) as bigint);
  } catch {
    return {
      sponsoredRemaining: 0,
      sponsoredUsed: 3,
      qusdcGasConfigured: true,
      policyManagerConfigured: APP_CONFIG.agentPolicyManager !== undefined,
      status: "paused",
      reason: "Paymaster status is unavailable.",
    };
  }

  const policyManagerConfigured = APP_CONFIG.agentPolicyManager !== undefined;
  return {
    sponsoredRemaining,
    sponsoredUsed: Math.max(0, 3 - sponsoredRemaining),
    qusdcGasConfigured: true,
    policyManagerConfigured,
    status: policyManagerConfigured ? "active" : "paused",
    reason: policyManagerConfigured
      ? "A valid gas route is available."
      : "AgentPolicyManager is not configured for this deployment.",
  };
}
