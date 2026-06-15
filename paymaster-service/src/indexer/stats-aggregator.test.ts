import { describe, expect, it } from "vitest";
import type { QevieProtocolEvent } from "@qevie/sdk";
import { aggregateMyStats, aggregateProtocolStats } from "./stats-aggregator.js";

const CHAIN = 1990;
const NOW = 1_900_000_000; // fixed "now" so 24h/7d windows are deterministic
const SA_A = "0x00000000000000000000000000000000000000aa" as const;
const SA_B = "0x00000000000000000000000000000000000000bb" as const;

let counter = 0;
function ev(partial: Partial<QevieProtocolEvent> & Pick<QevieProtocolEvent, "type">): QevieProtocolEvent {
  counter += 1;
  return {
    id: `${CHAIN}:0x${counter.toString(16).padStart(64, "0")}:${counter}`,
    chainId: CHAIN,
    status: "confirmed",
    timestamp: NOW - 60,
    ...partial,
  } as QevieProtocolEvent;
}

const baseCfg = {
  chainId: CHAIN,
  receiptsConfigured: true,
  domainsConfigured: true,
  lastIndexedBlock: 1234,
  now: NOW,
};

describe("aggregateProtocolStats", () => {
  it("sums confirmed volume across non-overlapping payment types only", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "1000000", smartAccount: SA_A }), // 1.0
      ev({ type: "SESSION_EXECUTED", amountQusdc: "2000000", smartAccount: SA_A }), // 2.0
      ev({ type: "BATCH_EXECUTED", amountQusdc: "3000000" }), // 3.0
      ev({ type: "REQUEST_SETTLED", amountQusdc: "500000" }), // 0.5
      ev({ type: "SUBSCRIPTION_EXECUTED", amountQusdc: "500000" }), // 0.5
      // Non-volume events must NOT contribute:
      ev({ type: "RECEIPT_CREATED", amountQusdc: "9999000000" }),
      ev({ type: "QUSDC_GAS_CHARGED", amountQusdc: "40000" }),
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.payments.totalVolume).toBe("7000000"); // 7.0 QUSDC
    expect(s.overview.totalQusdcVolume).toBe("7000000");
    expect(s.payments.batchPayments).toBe(1);
    expect(s.payments.singlePayments).toBe(2); // PAYMENT_EXECUTED + SESSION_EXECUTED
    expect(s.payments.totalPayments).toBe(5);
  });

  it("separates pending from confirmed and never counts pending volume", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "1000000" }),
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "5000000", status: "pending" }),
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "9000000", status: "failed" }),
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.payments.totalVolume).toBe("1000000"); // only the confirmed one
  });

  it("classifies policies into active / expired / revoked", () => {
    const events = [
      ev({ type: "POLICY_CREATED", policyId: "0xpolicy1" as `0x${string}`, smartAccount: SA_A, reason: `validUntil=${NOW + 1000}` }),
      ev({ type: "POLICY_CREATED", policyId: "0xpolicy2" as `0x${string}`, smartAccount: SA_A, reason: `validUntil=${NOW - 1000}` }),
      ev({ type: "POLICY_CREATED", policyId: "0xpolicy3" as `0x${string}`, smartAccount: SA_B, reason: `validUntil=${NOW + 1000}` }),
      ev({ type: "POLICY_REVOKED", policyId: "0xpolicy3" as `0x${string}`, smartAccount: SA_B }),
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.autopilot.confirmedPolicies).toBe(3);
    expect(s.autopilot.activePolicies).toBe(1); // policy1
    expect(s.autopilot.expiredPolicies).toBe(1); // policy2
    expect(s.autopilot.revokedPolicies).toBe(1); // policy3
    expect(s.overview.activePolicies).toBe(1);
  });

  it("windows volume by 24h and 7d", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "1000000", timestamp: NOW - 3600 }), // within 24h
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "2000000", timestamp: NOW - 2 * 86400 }), // within 7d, not 24h
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "4000000", timestamp: NOW - 30 * 86400 }), // older than 7d
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.payments.volume24h).toBe("1000000");
    expect(s.payments.volume7d).toBe("3000000");
    expect(s.payments.totalVolume).toBe("7000000");
  });

  it("counts autopilot executions from session events", () => {
    const events = [
      ev({ type: "SESSION_EXECUTED" }),
      ev({ type: "SESSION_EXECUTED", amountQusdc: "1000000" }),
      ev({ type: "SESSION_BATCH_EXECUTED" }),
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.overview.autopilotExecutions).toBe(3);
  });

  it("marks receipts/domains as not configured when sources are absent", () => {
    const s = aggregateProtocolStats([], {
      ...baseCfg,
      receiptsConfigured: false,
      domainsConfigured: false,
    });
    expect(s.receipts.configured).toBe(false);
    expect(s.receipts.reason).toContain("ReceiptRegistry");
    expect(s.domains.configured).toBe(false);
    expect(s.domains.reason).toContain("QIE Domain");
  });

  it("never reports guardian approvals or pause as tracked (not emitted on-chain)", () => {
    const s = aggregateProtocolStats([ev({ type: "GUARDIAN_REVOKED", policyId: "0xp" as `0x${string}` })], baseCfg);
    expect(s.autopilot.guardianVetoes).toBe(1);
    expect(s.autopilot.guardianApprovalsTracked).toBe(false);
    expect(s.autopilot.pausedPoliciesTracked).toBe(false);
  });

  it("ignores events from other chains", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "1000000" }),
      { ...ev({ type: "PAYMENT_EXECUTED", amountQusdc: "9000000" }), chainId: 1983 },
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.payments.totalVolume).toBe("1000000");
  });

  it("tolerates missing optional amount fields", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED" }), // no amountQusdc
      ev({ type: "BATCH_EXECUTED", amountQusdc: "2000000" }),
    ];
    const s = aggregateProtocolStats(events, baseCfg);
    expect(s.payments.totalVolume).toBe("2000000");
  });
});

describe("aggregateMyStats", () => {
  it("filters strictly to the connected smart account", () => {
    const events = [
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "1000000", smartAccount: SA_A }),
      ev({ type: "PAYMENT_EXECUTED", amountQusdc: "5000000", smartAccount: SA_B }),
      ev({ type: "POLICY_CREATED", policyId: "0xpa" as `0x${string}`, smartAccount: SA_A, reason: `validUntil=${NOW + 1000}` }),
      ev({ type: "POLICY_CREATED", policyId: "0xpb" as `0x${string}`, smartAccount: SA_B, reason: `validUntil=${NOW + 1000}` }),
    ];
    const mine = aggregateMyStats(events, SA_A, { chainId: CHAIN, now: NOW });
    expect(mine.qusdcVolume).toBe("1000000"); // only SA_A's payment
    expect(mine.activePolicies).toBe(1); // only SA_A's policy
    expect(mine.smartAccount).toBe(SA_A);
  });

  it("matches by issuer/owner too (receipts attributed to account)", () => {
    const events = [
      ev({ type: "RECEIPT_CREATED", smartAccount: SA_A }),
      ev({ type: "RECEIPT_CREATED", owner: SA_A }),
      ev({ type: "RECEIPT_CREATED", smartAccount: SA_B }),
    ];
    const mine = aggregateMyStats(events, SA_A, { chainId: CHAIN, now: NOW });
    expect(mine.receiptsCreated).toBe(2);
  });
});
