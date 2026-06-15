import React from "react";
import type { QevieProtocolEvent } from "../../lib/statsClient.js";
import {
  eventLabel,
  explorerTxUrl,
  formatQusdcAmount,
  relativeTime,
} from "../../lib/statsClient.js";

function statusColor(status: QevieProtocolEvent["status"]): string {
  if (status === "confirmed") return "var(--success)";
  if (status === "failed") return "var(--error)";
  return "var(--warning)";
}

function shortHex(value: string | undefined): string {
  if (value === undefined) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * One row in the full protocol feed. Shows the event label, a status dot,
 * amount (when present), the most relevant identifier, and an explorer link
 * when a txHash exists. `detailed={false}` renders the compact mini-feed form.
 */
export default function ActivityFeedItem({
  event,
  detailed = true,
}: {
  event: QevieProtocolEvent;
  detailed?: boolean;
}): React.ReactElement {
  const amount = event.amountQusdc !== undefined ? `$${formatQusdcAmount(event.amountQusdc)}` : null;
  const txUrl = explorerTxUrl(event.txHash);
  const identifier =
    event.qieDomainInput ??
    (event.policyId !== undefined ? `policy ${shortHex(event.policyId)}` : undefined) ??
    (event.smartAccount !== undefined ? shortHex(event.smartAccount) : undefined);

  return (
    <div
      className="flex-between"
      style={{ gap: "var(--s-2)", padding: "var(--s-1) 0", minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", minWidth: 0 }}>
        <span
          style={{
            flex: "0 0 auto",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor(event.status),
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.8125rem", color: "var(--text-pure)" }}>
            {eventLabel(event.type)}
            {event.status === "pending" && (
              <span className="chip chip-muted" style={{ marginLeft: 6, fontSize: "0.5625rem" }}>pending</span>
            )}
          </div>
          {detailed && identifier !== undefined && (
            <div className="text-muted" style={{ fontSize: "0.6875rem", overflowWrap: "anywhere" }}>
              {identifier}
              {event.resolvedAddress !== undefined ? ` → ${shortHex(event.resolvedAddress)}` : ""}
              {event.reason !== undefined && event.reason !== "private" && !event.reason.includes("=")
                ? ` · ${event.reason}`
                : ""}
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: "0 0 auto", textAlign: "right" }}>
        {amount !== null && (
          <div style={{ color: "var(--accent-light)", fontWeight: 700, fontSize: "0.8125rem" }}>{amount}</div>
        )}
        <div className="text-muted" style={{ fontSize: "0.625rem" }}>
          {relativeTime(event.timestamp)}
          {detailed && txUrl !== null && (
            <>
              {" · "}
              <a href={txUrl} target="_blank" rel="noreferrer" className="history-link" style={{ color: "var(--accent)" }}>
                tx ↗
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
