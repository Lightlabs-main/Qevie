import type { Address } from "viem";
import { PAYMASTER_ABI } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

export interface AutopilotGasStatus {
  sponsoredRemaining: number;
  sponsoredUsed: number;
  qusdcGasConfigured: boolean;
  policyManagerConfigured: boolean;
  executionEnabled: boolean;
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
      executionEnabled: APP_CONFIG.autopilotExecutionEnabled,
      status: "paused",
      reason: "Paymaster status is unavailable.",
    };
  }

  const policyManagerConfigured = APP_CONFIG.agentPolicyManager !== undefined;
  const executionEnabled = APP_CONFIG.autopilotExecutionEnabled;
  return {
    sponsoredRemaining,
    sponsoredUsed: Math.max(0, 3 - sponsoredRemaining),
    qusdcGasConfigured: true,
    policyManagerConfigured,
    executionEnabled,
    status: policyManagerConfigured && executionEnabled ? "active" : "paused",
    reason: !policyManagerConfigured
      ? "AgentPolicyManager is not configured for this deployment."
      : executionEnabled
        ? "A valid gas route is available."
        : "AgentPolicyManager is deployed, but session UserOp submission is not enabled yet.",
  };
}
