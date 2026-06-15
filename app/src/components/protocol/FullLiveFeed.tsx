import React, { useState } from "react";
import ActivityFeedItem from "./ActivityFeedItem.js";
import { useProtocolEvents } from "../../hooks/useProtocolStats.js";
import type { QevieProtocolEventType } from "../../lib/statsClient.js";

const FILTERS: Array<{ label: string; types?: QevieProtocolEventType[] }> = [
  { label: "All" },
  { label: "Autopilot", types: ["SESSION_EXECUTED", "SESSION_BATCH_EXECUTED", "POLICY_CREATED", "POLICY_REVOKED", "GUARDIAN_REVOKED"] },
  { label: "Payments", types: ["PAYMENT_EXECUTED", "BATCH_EXECUTED", "REQUEST_SETTLED", "SUBSCRIPTION_EXECUTED"] },
  { label: "Paymaster", types: ["PAYMASTER_SPONSORED", "QUSDC_GAS_CHARGED"] },
  { label: "Receipts", types: ["RECEIPT_CREATED"] },
  { label: "Domains", types: ["DOMAIN_RESOLVED", "DOMAIN_RESOLUTION_FAILED"] },
];

/**
 * Full protocol feed: filterable, status-badged, with explorer links and
 * pause-on-hover (so a reader can stop the auto-refresh to inspect a row). Shows
 * a loading spinner and an honest empty/error state while the indexer syncs.
 */
export default function FullLiveFeed(): React.ReactElement {
  const [filter, setFilter] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = FILTERS[filter] ?? FILTERS[0]!;
  const { data, loading, error } = useProtocolEvents({
    limit: 50,
    pollMs: 12_000,
    paused,
    ...(active.types !== undefined ? { types: active.types } : {}),
  });
  const events = data ?? [];

  return (
    <section style={{ marginTop: "var(--s-4)" }}>
      <div className="flex-between" style={{ marginBottom: "var(--s-2)", flexWrap: "wrap", gap: "var(--s-1)" }}>
        <div className="section-label" style={{ margin: 0 }}>Live Protocol Feed</div>
        {paused && <span className="chip chip-muted" style={{ fontSize: "0.6rem" }}>paused</span>}
      </div>

      <div style={{ display: "flex", gap: "var(--s-1)", flexWrap: "wrap", marginBottom: "var(--s-2)" }}>
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            className={`chip ${i === filter ? "chip-accent" : "chip-muted"}`}
            onClick={() => setFilter(i)}
            style={{ fontSize: "0.6875rem" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        className="surface-card"
        style={{ padding: "var(--s-2)", maxHeight: 460, overflowY: "auto" }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {loading && events.length === 0 ? (
          <div className="flex-center" style={{ padding: "var(--s-3)" }}>
            <span className="spinner" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-muted" style={{ fontSize: "0.8125rem", textAlign: "center", padding: "var(--s-3)", lineHeight: 1.5 }}>
            {error !== null
              ? "Stats indexer is syncing. Confirmed events will appear here shortly."
              : "No confirmed events for this filter yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {events.map((e) => (
              <div key={e.id} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                <ActivityFeedItem event={e} detailed />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
