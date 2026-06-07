import type { Address, Hex } from "viem";
import type { GasMode, UserOpResult } from "../types.js";

export interface AgentPolicyDraft {
  sessionKey: Address;
  guardian: Address;
  recipients: Address[];
  maxPerTx: bigint;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  totalLimit: bigint;
  maxQusdcGasPerTx: bigint;
  dailyQusdcGasCap: bigint;
  validAfter: bigint;
  validUntil: bigint;
  allowSinglePayment: boolean;
  allowBatchPayment: boolean;
  allowPaymentRequest: boolean;
  allowSubscription: boolean;
  allowSponsoredGas: boolean;
  allowQusdcGas: boolean;
  allowNativeQieFallback: boolean;
  pauseWhenGasUnavailable: boolean;
}

export interface AgentPolicy extends Omit<AgentPolicyDraft, "recipients"> {
  policyId: Hex;
  smartAccount: Address;
  owner: Address;
  token: Address;
  spentToday: bigint;
  spentThisWeek: bigint;
  spentTotal: bigint;
  spentQusdcGasToday: bigint;
  dayWindowStart: bigint;
  weekWindowStart: bigint;
  gasDayWindowStart: bigint;
  active: boolean;
  guardianRevoked: boolean;
  recipients?: Address[];
}

export interface CreateAgentPolicyOptions {
  mode?: GasMode;
  waitForReceipt?: boolean;
}

export interface CreateAgentPolicyResult {
  policyId: Hex;
  userOpHash: Hex;
  result?: UserOpResult;
}

export interface SessionPaymentInput {
  smartAccount: Address;
  policyId: Hex;
  recipient: Address;
  amount: bigint;
  mode: GasMode;
}
