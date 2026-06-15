import React from "react";

/**
 * Compact KPI card used by the landing proof strip and the protocol dashboard.
 * Pure presentational — value formatting happens upstream so empty/loading
 * states stay honest (a dash, never a fake number).
 */
export default function KpiCard({
  label,
  value,
  hint,
  accent = "var(--accent)",
  loading = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  loading?: boolean;
}): React.ReactElement {
  return (
    <div className="surface-card" style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)", minWidth: 0 }}>
      <div className="section-label" style={{ margin: 0 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 800,
          fontSize: "1.375rem",
          color: "var(--text-pure)",
          lineHeight: 1.1,
          overflowWrap: "anywhere",
        }}
      >
        {loading ? <span className="spinner" /> : value}
      </div>
      {hint !== undefined && (
        <div style={{ fontSize: "0.6875rem", color: accent, fontWeight: 700 }}>{hint}</div>
      )}
    </div>
  );
}
