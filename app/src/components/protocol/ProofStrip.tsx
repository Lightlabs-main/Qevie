import React from "react";
import KpiCard from "./KpiCard.js";
import MiniLiveFeed from "./MiniLiveFeed.js";
import { useProtocolStats } from "../../hooks/useProtocolStats.js";
import { NETWORK_LABEL, formatQusdcAmount } from "../../lib/statsClient.js";

/**
 * Lightweight public proof strip for the landing page: a "Live on QIE" heading,
 * exactly four public KPI cards, and a compact moving feed with a CTA to the
 * full `/protocol` dashboard. Shows real indexed numbers, or honest zeros/empty
 * states while the indexer syncs — never fabricated activity.
 */
export default function ProofStrip(): React.ReactElement {
  const { data, loading } = useProtocolStats();
  const usd = `$${formatQusdcAmount(data?.overview.totalQusdcVolume)}`;
  const loadingKpis = loading && data === null;

  return (
    <section className="tight-stack" style={{ gap: "var(--s-2)" }}>
      <div className="flex-between">
        <div className="section-label" style={{ margin: 0 }}>Live on QIE</div>
        <span className="chip chip-muted" style={{ fontSize: "0.6rem" }}>{NETWORK_LABEL}</span>
      </div>

      <div className="tight-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KpiCard label="QUSDC Volume" value={usd} loading={loadingKpis} />
        <KpiCard label="Autopilot Execs" value={String(data?.overview.autopilotExecutions ?? 0)} loading={loadingKpis} accent="#a78bfa" />
        <KpiCard label="Active Policies" value={String(data?.overview.activePolicies ?? 0)} loading={loadingKpis} accent="#22c55e" />
        <KpiCard label="Receipts" value={String(data?.overview.receiptsCreated ?? 0)} loading={loadingKpis} accent="#f59e0b" />
      </div>

      <MiniLiveFeed limit={6} />
    </section>
  );
}
