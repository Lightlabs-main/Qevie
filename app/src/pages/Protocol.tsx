import React, { useState } from "react";
import { Link } from "react-router-dom";
import KpiCard from "../components/protocol/KpiCard.js";
import FullLiveFeed from "../components/protocol/FullLiveFeed.js";
import { ModeSplit, StatusRing, VolumeBars } from "../components/protocol/Charts.js";
import { useProtocolStats } from "../hooks/useProtocolStats.js";
import { NETWORK_LABEL, formatQusdcAmount } from "../lib/statsClient.js";

type Tab = "Autopilot" | "Payments" | "Paymaster" | "Receipts & Passport" | "QIE Domains";
const TABS: Tab[] = ["Autopilot", "Payments", "Paymaster", "Receipts & Passport", "QIE Domains"];

function StatRow({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="flex-between" style={{ padding: "var(--s-1) 0", borderBottom: "1px solid var(--glass-border)" }}>
      <span className="text-muted" style={{ fontSize: "0.8125rem" }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: "0.8125rem", color: "var(--text-pure)" }}>{value}</span>
    </div>
  );
}

function NotTracked({ what }: { what: string }): React.ReactElement {
  return (
    <div className="flex-between" style={{ padding: "var(--s-1) 0", borderBottom: "1px solid var(--glass-border)" }}>
      <span className="text-muted" style={{ fontSize: "0.8125rem" }}>{what}</span>
      <span className="chip chip-muted" style={{ fontSize: "0.6rem" }}>not emitted on-chain</span>
    </div>
  );
}

export default function Protocol(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("Autopilot");
  const { data, loading, error } = useProtocolStats();

  const usd = (s: string | undefined): string => `$${formatQusdcAmount(s)}`;

  return (
    <div style={{ paddingBottom: "var(--s-8)" }}>
      {/* Header */}
      <header className="page-header-tight" style={{ marginBottom: "var(--s-3)" }}>
        <div className="flex-between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "var(--s-2)" }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: "1.75rem", margin: 0 }}>Qevie Protocol Dashboard</h1>
            <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: 4 }}>
              Live, agent-native QUSDC execution on QIE.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span className="chip chip-accent" style={{ fontSize: "0.625rem" }}>{NETWORK_LABEL}</span>
            <div className="text-muted" style={{ fontSize: "0.625rem", marginTop: 6 }}>
              {data?.lastIndexedBlock != null ? `Block ${data.lastIndexedBlock.toLocaleString()}` : "Indexer syncing"}
            </div>
            {data?.updatedAt != null && (
              <div className="text-muted" style={{ fontSize: "0.625rem" }}>
                Updated {new Date(data.updatedAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </header>

      {error !== null && data === null && (
        <div className="surface-card text-muted" style={{ fontSize: "0.8125rem", textAlign: "center", padding: "var(--s-3)", marginBottom: "var(--s-3)", lineHeight: 1.5 }}>
          Stats indexer is syncing. Live protocol metrics will appear after confirmed events.
        </div>
      )}

      {/* Top KPI cards */}
      <section className="tight-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "var(--s-4)" }}>
        <KpiCard label="Total QUSDC Volume" value={usd(data?.overview.totalQusdcVolume)} loading={loading && data === null} accent="var(--accent)" />
        <KpiCard label="Autopilot Executions" value={String(data?.overview.autopilotExecutions ?? 0)} loading={loading && data === null} accent="#a78bfa" />
        <KpiCard label="Active Policies" value={String(data?.overview.activePolicies ?? 0)} loading={loading && data === null} accent="#22c55e" />
        <KpiCard label="Receipts Created" value={String(data?.overview.receiptsCreated ?? 0)} loading={loading && data === null} accent="#f59e0b" />
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "var(--s-1)", flexWrap: "wrap", marginBottom: "var(--s-3)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            className={`chip ${t === tab ? "chip-accent" : "chip-muted"}`}
            onClick={() => setTab(t)}
            style={{ fontSize: "0.6875rem" }}
          >
            {t}
          </button>
        ))}
      </div>

      <section className="surface-card" style={{ marginBottom: "var(--s-2)" }}>
        {tab === "Autopilot" && data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
            <StatusRing
              centerLabel="policies"
              segments={[
                { label: "Active", value: data.autopilot.activePolicies, color: "#22c55e" },
                { label: "Pending", value: data.autopilot.pendingPolicies, color: "#f59e0b" },
                { label: "Revoked", value: data.autopilot.revokedPolicies, color: "var(--error)" },
                { label: "Expired", value: data.autopilot.expiredPolicies, color: "#64748b" },
              ]}
            />
            <div>
              <StatRow label="Confirmed policies" value={data.autopilot.confirmedPolicies} />
              <StatRow label="Guardian vetoes" value={data.autopilot.guardianVetoes} />
              <NotTracked what="Guardian approvals" />
              <NotTracked what="Paused policies" />
            </div>
          </div>
        )}

        {tab === "Payments" && data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
            <VolumeBars
              bars={[
                { label: "24h", value: Number(data.payments.volume24h), display: usd(data.payments.volume24h) },
                { label: "7d", value: Number(data.payments.volume7d), display: usd(data.payments.volume7d) },
                { label: "All", value: Number(data.payments.totalVolume), display: usd(data.payments.totalVolume) },
              ]}
            />
            <div>
              <StatRow label="Total payments" value={data.payments.totalPayments} />
              <StatRow label="Single payments" value={data.payments.singlePayments} />
              <StatRow label="Batch payments" value={data.payments.batchPayments} />
              <StatRow label="Requests settled" value={data.payments.requestSettlements} />
              <StatRow label="Subscription charges" value={data.payments.subscriptionExecutions} />
            </div>
          </div>
        )}

        {tab === "Paymaster" && data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
            <ModeSplit
              segments={[
                { label: "Sponsored", value: data.paymaster.sponsoredActions, color: "var(--accent)" },
                { label: "QUSDC Gas", value: data.paymaster.qusdcGasActions, color: "#a78bfa" },
              ]}
            />
            <div>
              <StatRow label="Sponsored onboarding ops" value={data.paymaster.sponsoredActions} />
              <StatRow label="QUSDC-gas ops" value={data.paymaster.qusdcGasActions} />
              <StatRow label="QUSDC gas recovered" value={usd(data.paymaster.qusdcGasRecovered)} />
              <NotTracked what="Native-fallback ops" />
              <NotTracked what="Total UserOps routed" />
            </div>
          </div>
        )}

        {tab === "Receipts & Passport" && data && (
          <div>
            {data.receipts.configured ? (
              <>
                <StatRow label="Receipts created" value={data.receipts.receiptsCreated ?? 0} />
                <StatRow label="Receipts (24h)" value={data.receipts.receiptsCreated24h ?? 0} />
                <StatRow label="Public receipts" value={data.receipts.publicReceipts ?? 0} />
                <StatRow label="Private receipts" value={data.receipts.privateReceipts ?? 0} />
              </>
            ) : (
              <div className="text-muted" style={{ fontSize: "0.8125rem", padding: "var(--s-2)", lineHeight: 1.5 }}>
                {data.receipts.reason ?? "ReceiptRegistry is not configured on this network."}
              </div>
            )}
          </div>
        )}

        {tab === "QIE Domains" && data && (
          <div>
            {data.domains.configured ? (
              <>
                <StatRow label="Resolutions" value={data.domains.resolutions ?? 0} />
                <StatRow label="Successful" value={data.domains.successfulResolutions ?? 0} />
                <StatRow label="Failed" value={data.domains.failedResolutions ?? 0} />
              </>
            ) : (
              <div className="text-muted" style={{ fontSize: "0.8125rem", padding: "var(--s-2)", lineHeight: 1.5 }}>
                {data.domains.reason ?? "QIE Domain Resolver is not configured on this network. Domain metrics will appear once resolution is enabled."}
              </div>
            )}
          </div>
        )}

        {data === null && (
          <div className="flex-center" style={{ padding: "var(--s-4)" }}>
            {loading ? <span className="spinner" /> : <span className="text-muted" style={{ fontSize: "0.8125rem" }}>No data indexed yet.</span>}
          </div>
        )}
      </section>

      {/* Full live feed */}
      <FullLiveFeed />

      <div style={{ textAlign: "center", marginTop: "var(--s-4)" }}>
        <Link to="/" style={{ fontSize: "0.75rem", color: "var(--text-muted)", textDecoration: "none" }}>
          ← Back to Qevie
        </Link>
      </div>
    </div>
  );
}
