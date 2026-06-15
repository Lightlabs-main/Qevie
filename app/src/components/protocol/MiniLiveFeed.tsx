import React from "react";
import { Link } from "react-router-dom";
import { useProtocolEvents } from "../../hooks/useProtocolStats.js";
import { eventLabel, formatQusdcAmount, relativeTime } from "../../lib/statsClient.js";

/**
 * Compact landing-page feed: latest 5–8 public events, short labels, a subtle
 * fade-in on the newest item, and a CTA to the full dashboard. Renders an honest
 * empty state while the indexer is syncing instead of fabricating activity.
 */
export default function MiniLiveFeed({ limit = 6 }: { limit?: number }): React.ReactElement {
  const { data, loading, error } = useProtocolEvents({ limit, pollMs: 15_000 });
  const events = data ?? [];

  return (
    <div className="surface-card" style={{ padding: "var(--s-2)", overflow: "hidden" }}>
      {loading && events.length === 0 ? (
        <div className="flex-center" style={{ padding: "var(--s-2)" }}>
          <span className="spinner" />
        </div>
      ) : events.length === 0 ? (
        <div
          className="text-muted"
          style={{ fontSize: "0.75rem", textAlign: "center", padding: "var(--s-2)", lineHeight: 1.4 }}
        >
          {error !== null
            ? "Stats indexer is syncing. Live activity will appear after confirmed events."
            : "Qevie stats are syncing. Live activity will appear after confirmed events."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
          {events.map((e, i) => (
            <div
              key={e.id}
              className="protocol-feed-row"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span style={{ fontWeight: 700, fontSize: "0.78rem", color: "var(--text-pure)" }}>
                {eventLabel(e.type)}
              </span>
              <span className="text-muted" style={{ fontSize: "0.66rem" }}>
                {e.amountQusdc !== undefined ? `$${formatQusdcAmount(e.amountQusdc)} · ` : ""}
                {relativeTime(e.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link
        to="/protocol"
        style={{
          display: "block",
          marginTop: "var(--s-2)",
          textAlign: "center",
          fontSize: "0.75rem",
          fontWeight: 700,
          color: "var(--accent-light)",
          textDecoration: "none",
        }}
      >
        View Protocol Dashboard →
      </Link>
    </div>
  );
}
