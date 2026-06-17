import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import BackButton from "../components/BackButton.js";
import type { SubscriptionRecord } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import {
  formatQusdc,
  getBatchHistory,
  getIndexedActivity,
  getLinkHistory,
  getRequestHistory,
  shortAddress,
  type ActivityItem,
  type BatchHistoryItem,
  type LinkHistoryItem,
  type RequestHistoryItem,
} from "../lib/history.js";
import {
  frequencyLabel,
  isCancellable,
  loadSubscriptionsFor,
  subStatus,
} from "../lib/subscriptions.js";
import { APP_CONFIG } from "../config.js";

type Tab = "overview" | "links" | "requests" | "batches" | "subscriptions";
type DetailTab = "links" | "requests" | "batches";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

export default function History(): React.ReactElement {
  const client = useQevieClient();
  const { address, signer } = useWallet();

  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // This page is scoped to the connected wallet only — protocol-wide activity
  // lives on the Dashboard. Indexed (instant, server-side) is the primary source.
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [subs, setSubs] = useState<SubscriptionRecord[]>([]);
  // Detailed per-type tabs — scanned from the chain lazily, on demand. `null`
  // means "not loaded yet"; an array (even empty) means a scan has completed.
  const [links, setLinks] = useState<LinkHistoryItem[] | null>(null);
  const [requests, setRequests] = useState<RequestHistoryItem[] | null>(null);
  const [batches, setBatches] = useState<BatchHistoryItem[] | null>(null);
  const [tabLoading, setTabLoading] = useState<DetailTab | null>(null);
  const [tabError, setTabError] = useState<Partial<Record<DetailTab, string>>>({});
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  // Detail scans in flight, so re-renders don't fire a second scan for a tab.
  const inFlight = useRef<Set<DetailTab>>(new Set());

  // Instant load: this wallet's indexed activity + its subscriptions. Neither
  // pages the slow RPC, so the overview never shows the "took too long" timeout.
  useEffect(() => {
    let mounted = true;
    setLinks(null);
    setRequests(null);
    setBatches(null);
    setTabError({});
    inFlight.current.clear();
    void (async () => {
      setLoading(true);
      setError(null);
      const results = await Promise.allSettled([
        getIndexedActivity(address),
        address !== null
          ? loadSubscriptionsFor(client, address)
          : Promise.resolve<SubscriptionRecord[]>([]),
      ]);
      if (!mounted) return;
      const [nextActivity, nextSubs] = results;
      setActivity(nextActivity.status === "fulfilled" ? nextActivity.value : []);
      setSubs(nextSubs.status === "fulfilled" ? nextSubs.value : []);
      if (nextActivity.status === "rejected") {
        setError("Activity service is unreachable right now. Open a detail tab to scan the chain directly.");
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [address, client]);

  // Lazy detail scan: only the open tab is scanned, one event-type at a time, so
  // we never fire the dozens-of-concurrent log queries that overwhelmed the RPC.
  useEffect(() => {
    if (address === null || (tab !== "links" && tab !== "requests" && tab !== "batches")) return;
    const detail = tab;
    const already = detail === "links" ? links : detail === "requests" ? requests : batches;
    if (already !== null || inFlight.current.has(detail)) return;

    let mounted = true;
    inFlight.current.add(detail);
    setTabLoading(detail);
    setTabError((prev) => ({ ...prev, [detail]: undefined }));
    void (async () => {
      try {
        if (detail === "links") {
          const value = await withTimeout(getLinkHistory(client, address), 25_000);
          if (mounted) setLinks(value);
        } else if (detail === "requests") {
          const value = await withTimeout(getRequestHistory(client, address), 25_000);
          if (mounted) setRequests(value);
        } else {
          const value = await withTimeout(getBatchHistory(client, address), 25_000);
          if (mounted) setBatches(value);
        }
      } catch {
        if (!mounted) return;
        // A failed scan still resolves the tab to empty so it stops spinning;
        // the indexed overview remains the reliable view.
        if (detail === "links") setLinks([]);
        else if (detail === "requests") setRequests([]);
        else setBatches([]);
        setTabError((prev) => ({
          ...prev,
          [detail]: "The QIE RPC was too slow to scan full detail. Your confirmed activity is on the Overview tab.",
        }));
      } finally {
        inFlight.current.delete(detail);
        if (mounted) setTabLoading((cur) => (cur === detail ? null : cur));
      }
    })();
    return () => { mounted = false; };
  }, [tab, address, client, links, requests, batches]);

  const handleCancelSub = async (subId: bigint): Promise<void> => {
    if (signer === null) {
      setError("Connect your wallet to cancel a subscription.");
      return;
    }
    setCancelingId(subId.toString());
    setError(null);
    try {
      await client.cancelSubscription(signer, subId);
      if (address !== null) setSubs(await loadSubscriptionsFor(client, address));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel subscription");
    } finally {
      setCancelingId(null);
    }
  };

  // Counts come from the indexed activity (instant), so the cards are populated
  // immediately on the overview without waiting for any chain scan.
  const summary = useMemo(() => {
    const count = (...types: ActivityItem["type"][]): number =>
      activity.filter((item) => item.status !== "failed" && types.includes(item.type)).length;
    return {
      payments: count("PAYMENT_EXECUTED", "SESSION_EXECUTED"),
      batches: count("BATCH_EXECUTED", "SESSION_BATCH_EXECUTED"),
      requestsSettled: count("REQUEST_SETTLED"),
      recurring: subs.filter((s) => s.active).length,
    };
  }, [activity, subs]);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <BackButton />
        <h2 className="page-title">History</h2>
      </div>

      <div className="tight-grid" style={{ marginBottom: "var(--s-3)" }}>
        <MetricCard label="Payments" value={`${summary.payments}`} />
        <MetricCard label="Batch payouts" value={`${summary.batches}`} />
        <MetricCard label="Requests settled" value={`${summary.requestsSettled}`} />
        <MetricCard label="Recurring active" value={`${summary.recurring}`} />
      </div>

      <div className="history-tabs" style={{ marginBottom: "var(--s-3)" }}>
        {[
          ["overview", "Overview"],
          ["links", "Links"],
          ["requests", "Requests"],
          ["batches", "Batches"],
          ["subscriptions", "Subscriptions"],
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
        <div className="surface-card" style={{ marginBottom: "var(--s-3)" }}>
          <div className="flex-center" style={{ gap: "0.65rem", justifyContent: "flex-start" }}>
            <span className="spinner" />
            <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
              Loading recent history…
            </span>
          </div>
        </div>
      )}

      {error !== null && (
        <div className="alert alert-error">{error}</div>
      )}

      {tab === "overview" && (
        <div className="tight-stack">
          <section className="surface-card">
            <div className="section-label">Your recent activity</div>
            <div className="tight-stack">
              {activity.length === 0 ? (
                <EmptyState label="No confirmed activity yet for this wallet." />
              ) : (
                activity.slice(0, 8).map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))
              )}
            </div>
          </section>

          {subs.length > 0 && (
            <section className="surface-card">
              <div className="section-label">Recurring payments</div>
              <div className="tight-stack">
                {subs.slice(0, 3).map((sub) => (
                  <SubscriptionRow
                    key={sub.subId.toString()}
                    sub={sub}
                    canceling={cancelingId === sub.subId.toString()}
                    onCancel={() => { void handleCancelSub(sub.subId); }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "links" && (
        <DetailSection
          loading={tabLoading === "links"}
          error={tabError.links}
          empty={(links?.length ?? 0) === 0}
          emptyLabel="No payment links found for this wallet."
        >
          {(links ?? []).map((item) => (
            <LinkRow key={item.id} item={item} />
          ))}
        </DetailSection>
      )}

      {tab === "requests" && (
        <DetailSection
          loading={tabLoading === "requests"}
          error={tabError.requests}
          empty={(requests?.length ?? 0) === 0}
          emptyLabel="No request history found for this wallet."
        >
          {(requests ?? []).map((item) => (
            <RequestRow key={item.requestId.toString()} item={item} />
          ))}
        </DetailSection>
      )}

      {tab === "batches" && (
        <DetailSection
          loading={tabLoading === "batches"}
          error={tabError.batches}
          empty={(batches?.length ?? 0) === 0}
          emptyLabel="No batch payments found for this wallet."
        >
          {(batches ?? []).map((item) => (
            <BatchRow key={item.batchId} item={item} />
          ))}
        </DetailSection>
      )}

      {tab === "subscriptions" && (
        <section className="tight-stack">
          {subs.length === 0 ? (
            <EmptyState label="No recurring payments found for this wallet." />
          ) : subs.map((sub) => (
            <SubscriptionRow
              key={sub.subId.toString()}
              sub={sub}
              canceling={cancelingId === sub.subId.toString()}
              onCancel={() => { void handleCancelSub(sub.subId); }}
            />
          ))}
        </section>
      )}
    </main>
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    void promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function MetricCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ padding: "var(--s-2)" }}>
      <div className="text-muted" style={{ fontSize: "0.75rem" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "var(--text-pure)" }}>{value}</div>
    </div>
  );
}

function DetailSection({
  loading,
  error,
  empty,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error?: string;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="surface-card">
        <div className="flex-center" style={{ gap: "0.65rem", justifyContent: "flex-start" }}>
          <span className="spinner" />
          <span className="text-muted" style={{ fontSize: "0.8125rem" }}>
            Scanning the chain for full detail…
          </span>
        </div>
      </div>
    );
  }
  return (
    <section className="tight-stack">
      {error !== undefined && <div className="alert alert-error">{error}</div>}
      {empty ? <EmptyState label={emptyLabel} /> : children}
    </section>
  );
}

function ActivityRow({ item }: { item: ActivityItem }): React.ReactElement {
  return (
    <div className="history-feed-row">
      <div>
        <div style={{ fontWeight: 700 }}>{item.title}</div>
        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
          {item.subtitle ? `${item.subtitle} · ` : ""}{formatTime(item.timestamp)}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        {item.amount !== null && (
          <div style={{ fontWeight: 700 }}>{formatQusdc(item.amount)}</div>
        )}
        {item.txHash !== null && (
          <a href={`${EXPLORER}/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="history-link">
            tx ↗
          </a>
        )}
      </div>
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

function SubscriptionRow({
  sub,
  canceling,
  onCancel,
}: {
  sub: SubscriptionRecord;
  canceling: boolean;
  onCancel(): void;
}): React.ReactElement {
  const status = subStatus(sub);
  return (
    <div className="surface-card history-row">
      <div className="flex-between" style={{ gap: "var(--s-2)" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {formatQusdc(sub.amount)} · {frequencyLabel(Number(sub.period))}
          </div>
          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
            To {shortAddress(sub.payee)} · {sub.paymentsMade.toString()}/{sub.maxPayments.toString()} paid
          </div>
        </div>
        <span className={status.cls}>{status.label}</span>
      </div>
      {sub.active && (
        <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: "var(--s-2)" }}>
          Next charge {formatTime(Number(sub.nextChargeAt) * 1000)}
        </div>
      )}
      {isCancellable(sub) && (
        <button
          className="btn-secondary btn-sm"
          disabled={canceling}
          onClick={onCancel}
          style={{ marginTop: "var(--s-2)", alignSelf: "flex-start" }}
        >
          {canceling ? "Cancelling…" : "Cancel subscription"}
        </button>
      )}
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
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown time";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
