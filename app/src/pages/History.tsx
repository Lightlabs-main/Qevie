import React, { useEffect, useMemo, useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import {
  formatQusdc,
  getBatchHistory,
  getGlobalFeed,
  getLinkHistory,
  getRequestHistory,
  shortAddress,
  type BatchHistoryItem,
  type FeedItem,
  type LinkHistoryItem,
  type RequestHistoryItem,
} from "../lib/history.js";
import { APP_CONFIG } from "../config.js";

type Tab = "overview" | "links" | "requests" | "batches";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

export default function History(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();

  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkHistoryItem[]>([]);
  const [requests, setRequests] = useState<RequestHistoryItem[]>([]);
  const [batches, setBatches] = useState<BatchHistoryItem[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [nextLinks, nextRequests, nextBatches, nextFeed] = await Promise.all([
          getLinkHistory(client, address),
          getRequestHistory(client, address),
          getBatchHistory(client, address),
          getGlobalFeed(client),
        ]);
        if (!mounted) return;
        setLinks(nextLinks);
        setRequests(nextRequests);
        setBatches(nextBatches);
        setFeed(nextFeed);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [address, client]);

  const summary = useMemo(() => {
    const paidLinks = links.filter((item) => item.status === "paid").length;
    const unpaidLinks = links.length - paidLinks;
    const paidRequests = requests.filter((item) => item.status === "paid").length;
    const unpaidRequests = requests.filter((item) => item.status === "unpaid").length;
    return { paidLinks, unpaidLinks, paidRequests, unpaidRequests };
  }, [links, requests]);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">History</h2>
      </div>

      <div className="tight-grid" style={{ marginBottom: "var(--s-3)" }}>
        <MetricCard label="Links paid" value={`${summary.paidLinks}`} />
        <MetricCard label="Links unpaid" value={`${summary.unpaidLinks}`} />
        <MetricCard label="Requests paid" value={`${summary.paidRequests}`} />
        <MetricCard label="Requests unpaid" value={`${summary.unpaidRequests}`} />
      </div>

      <div className="history-tabs" style={{ marginBottom: "var(--s-3)" }}>
        {[
          ["overview", "Overview"],
          ["links", "Links"],
          ["requests", "Requests"],
          ["batches", "Batches"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`history-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key as Tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex-center" style={{ minHeight: "30vh" }}>
          <span className="spinner spinner-lg" />
        </div>
      )}

      {!loading && error !== null && (
        <div className="alert alert-error">{error}</div>
      )}

      {!loading && error === null && tab === "overview" && (
        <div className="tight-stack">
          <section className="surface-card">
            <div className="section-label">Live app feed</div>
            <div className="tight-stack">
              {feed.length === 0 ? (
                <EmptyState label="No recent on-chain app activity yet." />
              ) : (
                feed.map((item) => (
                  <FeedRow key={item.id} item={item} />
                ))
              )}
            </div>
          </section>

          <section className="surface-card">
            <div className="section-label">Recent links</div>
            <div className="tight-stack">
              {links.length === 0 ? <EmptyState label="No links created yet." /> : links.slice(0, 4).map((item) => (
                <LinkRow key={item.id} item={item} />
              ))}
            </div>
          </section>

          <section className="surface-card">
            <div className="section-label">Recent requests & batches</div>
            <div className="tight-stack">
              {requests.slice(0, 2).map((item) => (
                <RequestRow key={`request_${item.requestId.toString()}`} item={item} />
              ))}
              {batches.slice(0, 2).map((item) => (
                <BatchRow key={item.batchId} item={item} />
              ))}
              {requests.length === 0 && batches.length === 0 && (
                <EmptyState label="No request or batch history yet." />
              )}
            </div>
          </section>
        </div>
      )}

      {!loading && error === null && tab === "links" && (
        <section className="tight-stack">
          {links.length === 0 ? <EmptyState label="No payment links created yet." /> : links.map((item) => (
            <LinkRow key={item.id} item={item} />
          ))}
        </section>
      )}

      {!loading && error === null && tab === "requests" && (
        <section className="tight-stack">
          {requests.length === 0 ? <EmptyState label="No request history found for this wallet." /> : requests.map((item) => (
            <RequestRow key={item.requestId.toString()} item={item} />
          ))}
        </section>
      )}

      {!loading && error === null && tab === "batches" && (
        <section className="tight-stack">
          {batches.length === 0 ? <EmptyState label="No batch payments found for this wallet." /> : batches.map((item) => (
            <BatchRow key={item.batchId} item={item} />
          ))}
        </section>
      )}
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ padding: "var(--s-2)" }}>
      <div className="text-muted" style={{ fontSize: "0.75rem" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "var(--text-pure)" }}>{value}</div>
    </div>
  );
}

function LinkRow({ item }: { item: LinkHistoryItem }): React.ReactElement {
  return (
    <div className="surface-card history-row">
      <div className="flex-between" style={{ gap: "var(--s-2)" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{item.label}</div>
          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
            {item.to} · {formatTime(item.createdAt)}
          </div>
        </div>
        <StatusChip status={item.status} />
      </div>
      <div className="flex-between" style={{ marginTop: "var(--s-2)", gap: "var(--s-2)" }}>
        <span style={{ fontWeight: 700 }}>{formatQusdc(item.amount)}</span>
        <a href={item.shareUrl} target="_blank" rel="noreferrer" className="history-link">
          Open link ↗
        </a>
      </div>
    </div>
  );
}

function RequestRow({ item }: { item: RequestHistoryItem }): React.ReactElement {
  return (
    <div className="surface-card history-row">
      <div className="flex-between" style={{ gap: "var(--s-2)" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Request #{item.requestId.toString()}</div>
          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
            {shortAddress(item.requestor)} → {shortAddress(item.payer)} · {formatTime(item.createdAt)}
          </div>
        </div>
        <StatusChip status={item.status} />
      </div>
      <div className="flex-between" style={{ marginTop: "var(--s-2)", gap: "var(--s-2)" }}>
        <span style={{ fontWeight: 700 }}>{formatQusdc(item.amount)}</span>
        <div className="text-muted" style={{ fontSize: "0.75rem", textAlign: "right" }}>
          {item.memo || "No memo"}
        </div>
      </div>
      {item.settledTxHash !== null && (
        <a
          href={`${EXPLORER}/tx/${item.settledTxHash}`}
          target="_blank"
          rel="noreferrer"
          className="history-link"
          style={{ marginTop: "var(--s-2)" }}
        >
          View settlement ↗
        </a>
      )}
    </div>
  );
}

function BatchRow({ item }: { item: BatchHistoryItem }): React.ReactElement {
  return (
    <div className="surface-card history-row">
      <div className="flex-between" style={{ gap: "var(--s-2)" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Batch payout</div>
          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
            {item.recipients.length} recipients · {formatTime(item.createdAt)}
          </div>
        </div>
        <StatusChip status="paid" />
      </div>
      <div className="flex-between" style={{ marginTop: "var(--s-2)", gap: "var(--s-2)" }}>
        <span style={{ fontWeight: 700 }}>{formatQusdc(item.totalAmount)}</span>
        {item.txHash !== null && (
          <a href={`${EXPLORER}/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="history-link">
            View tx ↗
          </a>
        )}
      </div>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }): React.ReactElement {
  return (
    <div className="history-feed-row">
      <div>
        <div style={{ fontWeight: 700 }}>{item.title}</div>
        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
          {item.subtitle} · {formatTime(item.timestamp)}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700 }}>{formatQusdc(item.amount)}</div>
        {item.txHash !== null && (
          <a href={`${EXPLORER}/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="history-link">
            tx ↗
          </a>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: "paid" | "unpaid" | "cancelled" }): React.ReactElement {
  const cls = status === "paid" ? "chip-success" : status === "cancelled" ? "chip-error" : "chip-muted";
  return <span className={`chip ${cls}`}>{status.toUpperCase()}</span>;
}

function EmptyState({ label }: { label: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ textAlign: "center", padding: "var(--s-3)" }}>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  if (timestamp <= 0) return "Unknown time";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
