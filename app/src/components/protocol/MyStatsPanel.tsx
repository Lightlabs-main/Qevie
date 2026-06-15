import React from "react";
import { Link } from "react-router-dom";
import { useMyStats } from "../../hooks/useProtocolStats.js";
import { formatQusdcAmount } from "../../lib/statsClient.js";

function Cell({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="surface-card" style={{ padding: "var(--s-2)", display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="text-muted" style={{ fontSize: "0.6875rem" }}>{label}</span>
      <span style={{ fontWeight: 800, fontSize: "1.0625rem", color: "var(--text-pure)" }}>{value}</span>
    </div>
  );
}

/**
 * Wallet-scoped activity for the connected smart account. Strictly personal —
 * it never shows protocol-wide totals (those live on `/protocol`, linked below).
 */
export default function MyStatsPanel({ smartAccount }: { smartAccount: string | null }): React.ReactElement | null {
  const { data, loading, error } = useMyStats(smartAccount);
  if (smartAccount === null) return null;

  return (
    <section className="tight-stack" style={{ gap: "var(--s-2)" }}>
      <div className="flex-between">
        <div className="section-label" style={{ margin: 0 }}>Your activity</div>
        <Link to="/protocol" style={{ fontSize: "0.6875rem", color: "var(--accent-light)", textDecoration: "none", fontWeight: 700 }}>
          View global protocol stats →
        </Link>
      </div>

      {loading && data === null ? (
        <div className="surface-card flex-center" style={{ padding: "var(--s-3)" }}><span className="spinner" /></div>
      ) : data === null ? (
        <div className="surface-card text-muted" style={{ fontSize: "0.8125rem", padding: "var(--s-2)", textAlign: "center", lineHeight: 1.5 }}>
          {error !== null
            ? "Stats are syncing. Your policies, receipts, and executions will appear here."
            : "No personal activity yet. Your policies, receipts, and executions will appear here."}
        </div>
      ) : (
        <div className="tight-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <Cell label="Active policies" value={data.activePolicies} />
          <Cell label="Pending policies" value={data.pendingPolicies} />
          <Cell label="Autopilot executions" value={data.autopilotExecutions} />
          <Cell label="My receipts" value={data.receiptsCreated} />
          <Cell label="My QUSDC volume" value={`$${formatQusdcAmount(data.qusdcVolume)}`} />
          <Cell label="Gas sponsored / QUSDC" value={`${data.sponsoredActions} / ${data.qusdcGasActions}`} />
          <Cell label="Revoked policies" value={data.revokedPolicies} />
          <Cell label="Blocked actions" value={data.blockedActions} />
        </div>
      )}
    </section>
  );
}
