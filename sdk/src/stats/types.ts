/**
 * Qevie Protocol Stats — shared types.
 *
 * Single source of truth for the protocol-stats data model, imported by both
 * the paymaster-service indexer (which produces these records) and the SDK
 * `stats` namespace (which reads them). Every field maps to a real, confirmed
 * on-chain event or a clearly service-sourced record — there are no fabricated
 * metrics. Optional fields are absent (not zero) when a source is unavailable
 * on the active network.
 */

import type { Address, Hex } from "viem";

/** Discriminated kind for a single protocol activity event. */
export type QevieProtocolEventType =
  | "POLICY_CREATED"
  | "POLICY_PENDING"
  | "POLICY_REVOKED"
  | "GUARDIAN_REVOKED"
  | "SESSION_EXECUTED"
  | "SESSION_BATCH_EXECUTED"
  | "PAYMENT_EXECUTED"
  | "BATCH_EXECUTED"
  | "REQUEST_SETTLED"
  | "SUBSCRIPTION_EXECUTED"
  | "PAYMASTER_SPONSORED"
  | "QUSDC_GAS_CHARGED"
  | "RECEIPT_CREATED"
  | "DOMAIN_RESOLVED"
  | "DOMAIN_RESOLUTION_FAILED";

export type QevieProtocolEventStatus = "pending" | "confirmed" | "failed";

export type QevieGasModeLabel =
  | "SPONSORED_ONBOARDING"
  | "QUSDC_GAS"
  | "NATIVE_QIE"
  | "PAUSED";

/**
 * One normalized protocol event. `amountQusdc` is a base-unit (6-dec) string for
 * JSON safety. Confirmed events always carry `txHash` + `logIndex`; pending
 * events (service-submitted, not yet mined) use an app-generated `id` and omit
 * the chain coordinates until confirmed.
 */
export interface QevieProtocolEvent {
  id: string;
  chainId: number;
  type: QevieProtocolEventType;
  status: QevieProtocolEventStatus;
  /** Unix seconds. For confirmed events, the block timestamp; else insert time. */
  timestamp: number;
  txHash?: Hex;
  userOpHash?: Hex;
  blockNumber?: number;
  logIndex?: number;
  smartAccount?: Address;
  owner?: Address;
  policyId?: Hex;
  sessionKey?: Address;
  token?: Address;
  amountQusdc?: string;
  gasMode?: QevieGasModeLabel;
  qieDomainInput?: string;
  resolvedAddress?: Address;
  receiptId?: Hex;
  reason?: string;
}

export type StatsPeriod = "24h" | "7d" | "all";

export interface ProtocolOverview {
  totalQusdcVolume: string;
  autopilotExecutions: number;
  activePolicies: number;
  receiptsCreated: number;
}

export interface ProtocolAutopilotStats {
  confirmedPolicies: number;
  pendingPolicies: number;
  activePolicies: number;
  /** Policies with `validUntil` in the past. */
  expiredPolicies: number;
  revokedPolicies: number;
  /** Real guardian veto/revocations (`AgentPolicyGuardianRevoked`). */
  guardianVetoes: number;
  /**
   * Not emitted on-chain today (no GuardianApproved / on-chain pause event).
   * Kept explicit so the UI can render "not tracked" rather than a fake 0.
   */
  guardianApprovalsTracked: false;
  pausedPoliciesTracked: false;
}

export interface ProtocolPaymentStats {
  totalVolume: string;
  volume24h: string;
  volume7d: string;
  totalPayments: number;
  singlePayments: number;
  batchPayments: number;
  requestSettlements: number;
  subscriptionExecutions: number;
}

export interface ProtocolPaymasterStats {
  sponsoredActions: number;
  qusdcGasActions: number;
  /** Sum of QUSDC pulled for gas (Mode A), base units. */
  qusdcGasRecovered: string;
  /** Sum of native QIE gas cost fronted (wei) across sponsored + Mode A. */
  estimatedQieGasPaidWei: string;
  /**
   * Per-UserOp native-fallback and total-UserOps-routed require an EntryPoint
   * receipt scan / a new paymaster event; not tracked from current events.
   */
  nativeFallbackTracked: false;
  totalUserOpsTracked: false;
}

export interface ProtocolReceiptStats {
  configured: boolean;
  /** Present only when `configured` (ReceiptRegistry deployed on this chain). */
  receiptsCreated?: number;
  receiptsCreated24h?: number;
  publicReceipts?: number;
  privateReceipts?: number;
  agentGeneratedReceipts?: number;
  reason?: string;
}

export interface ProtocolDomainStats {
  configured: boolean;
  resolutions?: number;
  successfulResolutions?: number;
  failedResolutions?: number;
  paymentsToDomains?: number;
  reason?: string;
}

export interface ProtocolStatsResponse {
  chainId: number;
  network: "QIE Mainnet" | "QIE Testnet";
  updatedAt: string;
  lastIndexedBlock: number | null;
  overview: ProtocolOverview;
  autopilot: ProtocolAutopilotStats;
  payments: ProtocolPaymentStats;
  paymaster: ProtocolPaymasterStats;
  receipts: ProtocolReceiptStats;
  domains: ProtocolDomainStats;
}

/** Wallet/smart-account-scoped stats. Never mixes in protocol-wide totals. */
export interface MyStatsResponse {
  chainId: number;
  network: "QIE Mainnet" | "QIE Testnet";
  smartAccount: Address;
  updatedAt: string;
  activePolicies: number;
  pendingPolicies: number;
  revokedPolicies: number;
  autopilotExecutions: number;
  receiptsCreated: number;
  qusdcVolume: string;
  sponsoredActions: number;
  qusdcGasActions: number;
  blockedActions: number;
}

export interface ProtocolEventsResponse {
  chainId: number;
  events: QevieProtocolEvent[];
}
