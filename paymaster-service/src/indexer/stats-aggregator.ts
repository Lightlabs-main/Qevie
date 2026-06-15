/**
 * Stats aggregator — folds stored protocol events into the typed responses the
 * API/SDK expose. Pure over its inputs (events + config flags + now), so it is
 * directly unit-testable. Confirmed volume only; pending and failed events never
 * contribute to volume or active counts. Receipt/domain sections degrade to
 * "not configured" when the underlying source is absent on the active network.
 */

import type { Address } from "viem";
import type {
  MyStatsResponse,
  ProtocolStatsResponse,
  QevieProtocolEvent,
} from "@qevie/sdk";

/** Event types that carry confirmed, settled QUSDC value (non-overlapping set). */
const VOLUME_TYPES = new Set<QevieProtocolEvent["type"]>([
  "PAYMENT_EXECUTED",
  "SESSION_EXECUTED",
  "BATCH_EXECUTED",
  "REQUEST_SETTLED",
  "SUBSCRIPTION_EXECUTED",
]);

function networkName(chainId: number): "QIE Mainnet" | "QIE Testnet" {
  return chainId === 1983 ? "QIE Testnet" : "QIE Mainnet";
}

function sumVolume(events: QevieProtocolEvent[]): bigint {
  let total = 0n;
  for (const e of events) {
    if (e.status !== "confirmed") continue;
    if (!VOLUME_TYPES.has(e.type)) continue;
    if (e.amountQusdc === undefined) continue;
    try {
      total += BigInt(e.amountQusdc);
    } catch {
      /* skip malformed */
    }
  }
  return total;
}

function parseTagged(reason: string | undefined, key: string): bigint | null {
  if (reason === undefined) return null;
  const m = new RegExp(`${key}=(\\d+)`).exec(reason);
  if (m === null || m[1] === undefined) return null;
  try {
    return BigInt(m[1]);
  } catch {
    return null;
  }
}

interface AggregateConfig {
  chainId: number;
  receiptsConfigured: boolean;
  domainsConfigured: boolean;
  lastIndexedBlock: number | null;
  /** Unix seconds. */
  now: number;
}

/** Policy lifecycle folded from POLICY_CREATED / POLICY_REVOKED, by policyId. */
interface PolicyState {
  smartAccount?: Address;
  validUntil: number;
  revoked: boolean;
  pending: boolean;
}

function foldPolicies(events: QevieProtocolEvent[]): Map<string, PolicyState> {
  const byId = new Map<string, PolicyState>();
  for (const e of events) {
    if (e.policyId === undefined) continue;
    if (e.type === "POLICY_CREATED") {
      const validUntil = Number(parseTagged(e.reason, "validUntil") ?? 0n);
      const prev = byId.get(e.policyId);
      byId.set(e.policyId, {
        ...(e.smartAccount !== undefined ? { smartAccount: e.smartAccount } : {}),
        validUntil,
        revoked: prev?.revoked ?? false,
        pending: false,
      });
    } else if (e.type === "POLICY_PENDING") {
      if (!byId.has(e.policyId)) {
        byId.set(e.policyId, { validUntil: 0, revoked: false, pending: true });
      }
    } else if (e.type === "POLICY_REVOKED") {
      const prev = byId.get(e.policyId);
      byId.set(e.policyId, {
        ...(prev ?? { validUntil: 0, pending: false }),
        revoked: true,
        pending: false,
      });
    }
  }
  return byId;
}

function classifyPolicies(states: Iterable<PolicyState>, now: number): {
  confirmed: number;
  pending: number;
  active: number;
  expired: number;
  revoked: number;
} {
  let confirmed = 0;
  let pending = 0;
  let active = 0;
  let expired = 0;
  let revoked = 0;
  for (const s of states) {
    if (s.pending) {
      pending += 1;
      continue;
    }
    confirmed += 1;
    if (s.revoked) {
      revoked += 1;
    } else if (s.validUntil !== 0 && s.validUntil <= now) {
      expired += 1;
    } else {
      active += 1;
    }
  }
  return { confirmed, pending, active, expired, revoked };
}

export function aggregateProtocolStats(
  allEvents: QevieProtocolEvent[],
  cfg: AggregateConfig,
): ProtocolStatsResponse {
  const events = allEvents.filter((e) => e.chainId === cfg.chainId);
  const since24h = cfg.now - 24 * 3600;
  const since7d = cfg.now - 7 * 24 * 3600;

  const policy = classifyPolicies(foldPolicies(events).values(), cfg.now);

  const count = (type: QevieProtocolEvent["type"]): number =>
    events.filter((e) => e.type === type && e.status === "confirmed").length;

  const totalVolume = sumVolume(events);
  const volume24h = sumVolume(events.filter((e) => e.timestamp >= since24h));
  const volume7d = sumVolume(events.filter((e) => e.timestamp >= since7d));

  const autopilotExecutions = count("SESSION_EXECUTED") + count("SESSION_BATCH_EXECUTED");
  const singlePayments = count("PAYMENT_EXECUTED") + count("SESSION_EXECUTED");
  const batchPayments = count("BATCH_EXECUTED");
  const requestSettlements = count("REQUEST_SETTLED");
  const subscriptionExecutions = count("SUBSCRIPTION_EXECUTED");

  // Paymaster aggregates.
  let qusdcGasRecovered = 0n;
  let qieGasPaid = 0n;
  for (const e of events) {
    if (e.status !== "confirmed") continue;
    if (e.type === "QUSDC_GAS_CHARGED") {
      if (e.amountQusdc !== undefined) {
        try { qusdcGasRecovered += BigInt(e.amountQusdc); } catch { /* skip */ }
      }
      qieGasPaid += parseTagged(e.reason, "gasCostWei") ?? 0n;
    } else if (e.type === "PAYMASTER_SPONSORED") {
      qieGasPaid += parseTagged(e.reason, "gasCostWei") ?? 0n;
    }
  }

  // Receipts.
  const receiptEvents = events.filter((e) => e.type === "RECEIPT_CREATED" && e.status === "confirmed");
  const receipts: ProtocolStatsResponse["receipts"] = cfg.receiptsConfigured
    ? {
        configured: true,
        receiptsCreated: receiptEvents.length,
        receiptsCreated24h: receiptEvents.filter((e) => e.timestamp >= since24h).length,
        publicReceipts: receiptEvents.filter((e) => e.amountQusdc !== undefined).length,
        privateReceipts: receiptEvents.filter((e) => e.reason === "private").length,
      }
    : {
        configured: false,
        reason: "ReceiptRegistry is not configured on this network.",
      };

  // Domains.
  const domainResolved = count("DOMAIN_RESOLVED");
  const domainFailed = events.filter(
    (e) => e.type === "DOMAIN_RESOLUTION_FAILED",
  ).length;
  const domains: ProtocolStatsResponse["domains"] = cfg.domainsConfigured
    ? {
        configured: true,
        resolutions: domainResolved + domainFailed,
        successfulResolutions: domainResolved,
        failedResolutions: domainFailed,
      }
    : {
        configured: false,
        reason: "QIE Domain Resolver is not configured on this network.",
      };

  return {
    chainId: cfg.chainId,
    network: networkName(cfg.chainId),
    updatedAt: new Date(cfg.now * 1000).toISOString(),
    lastIndexedBlock: cfg.lastIndexedBlock,
    overview: {
      totalQusdcVolume: totalVolume.toString(),
      autopilotExecutions,
      activePolicies: policy.active,
      receiptsCreated: receipts.configured ? (receipts.receiptsCreated ?? 0) : 0,
    },
    autopilot: {
      confirmedPolicies: policy.confirmed,
      pendingPolicies: policy.pending,
      activePolicies: policy.active,
      expiredPolicies: policy.expired,
      revokedPolicies: policy.revoked,
      guardianVetoes: count("GUARDIAN_REVOKED"),
      guardianApprovalsTracked: false,
      pausedPoliciesTracked: false,
    },
    payments: {
      totalVolume: totalVolume.toString(),
      volume24h: volume24h.toString(),
      volume7d: volume7d.toString(),
      totalPayments:
        singlePayments + batchPayments + requestSettlements + subscriptionExecutions,
      singlePayments,
      batchPayments,
      requestSettlements,
      subscriptionExecutions,
    },
    paymaster: {
      sponsoredActions: count("PAYMASTER_SPONSORED"),
      qusdcGasActions: count("QUSDC_GAS_CHARGED"),
      qusdcGasRecovered: qusdcGasRecovered.toString(),
      estimatedQieGasPaidWei: qieGasPaid.toString(),
      nativeFallbackTracked: false,
      totalUserOpsTracked: false,
    },
    receipts,
    domains,
  };
}

export function aggregateMyStats(
  allEvents: QevieProtocolEvent[],
  smartAccount: Address,
  cfg: { chainId: number; now: number },
): MyStatsResponse {
  const acct = smartAccount.toLowerCase();
  const events = allEvents.filter(
    (e) =>
      e.chainId === cfg.chainId &&
      (e.smartAccount?.toLowerCase() === acct || e.owner?.toLowerCase() === acct),
  );

  const policy = classifyPolicies(foldPolicies(events).values(), cfg.now);
  const count = (type: QevieProtocolEvent["type"]): number =>
    events.filter((e) => e.type === type && e.status === "confirmed").length;

  return {
    chainId: cfg.chainId,
    network: networkName(cfg.chainId),
    smartAccount,
    updatedAt: new Date(cfg.now * 1000).toISOString(),
    activePolicies: policy.active,
    pendingPolicies: policy.pending,
    revokedPolicies: policy.revoked,
    autopilotExecutions: count("SESSION_EXECUTED") + count("SESSION_BATCH_EXECUTED"),
    receiptsCreated: count("RECEIPT_CREATED"),
    qusdcVolume: sumVolume(events).toString(),
    sponsoredActions: count("PAYMASTER_SPONSORED"),
    qusdcGasActions: count("QUSDC_GAS_CHARGED"),
    blockedActions: count("GUARDIAN_REVOKED"),
  };
}
