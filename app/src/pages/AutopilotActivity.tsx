import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import type { QevieReceipt } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { listIntents, type AutopilotIntent } from "../lib/autopilotIntents.js";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

const STATUS: Record<AutopilotIntent["status"], { label: string; chip: string }> = {
  scheduled: { label: "Scheduled", chip: "chip-accent" },
  confirming: { label: "Confirming", chip: "chip-accent" },
  completed: { label: "Completed", chip: "chip-success" },
  failed: { label: "Failed", chip: "chip-error" },
  cancelled: { label: "Cancelled", chip: "chip-muted" },
};

const GAS_LABEL: Record<string, string> = {
  SPONSORED_ONBOARDING: "Sponsored",
  QUSDC_GAS: "USDC gas",
  NATIVE_QIE: "Native QIE",
};

const RECEIPT_LABEL: Record<string, string> = {
  SINGLE_PAYMENT: "Payment",
  BATCH_PAYMENT: "Batch payout",
  PAYMENT_REQUEST_SETTLED: "Request settled",
  SUBSCRIPTION_PAYMENT: "Subscription",
  MERCHANT_CHECKOUT: "Checkout",
  MANUAL_RECEIPT: "Receipt",
};

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function fmtAmount(base: string): string {
  return (Number(base) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AutopilotActivity(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const [intents, setIntents] = useState<AutopilotIntent[]>([]);
  const [receipts, setReceipts] = useState<QevieReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (address === null) { setLoading(false); return; }
    let mounted = true;
    void (async () => {
      const [runs, recs] = await Promise.all([
        listIntents(address).catch(() => []),
        client.receipts.listForAccount(address).catch(() => []),
      ]);
      if (!mounted) return;
      setIntents([...runs].sort((a, b) => b.createdAt - a.createdAt));
      setReceipts(recs.slice(0, 10));
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [address, client]);

  const totalRuns = intents.reduce((n, i) => n + i.runsCompleted, 0);
  const active = intents.filter((i) => i.status === "scheduled" || i.status === "confirming").length;
  const failed = intents.filter((i) => i.status === "failed").length;

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Audit trail</div>
          <h2 className="page-title">Autopilot Activity</h2>
        </div>
        <Link className="history-link" to="/autopilot">Back</Link>
      </div>

      {/* Summary */}
      <section className="tight-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Metric label="Runs settled" value={String(totalRuns)} />
        <Metric label="Active" value={String(active)} />
        <Metric label="Failed" value={String(failed)} />
      </section>

      {loading ? (
        <div className="flex-center" style={{ padding: "var(--s-6)" }}><span className="spinner spinner-lg" /></div>
      ) : address === null ? (
        <section className="surface-card autopilot-empty tight-stack">
          <div className="autopilot-empty-icon">!</div>
          <h3>Connect your wallet</h3>
          <p className="text-muted">Connect to see your agent run log and receipts.</p>
        </section>
      ) : (
        <>
          {/* Agent runs */}
          <section className="tight-stack" style={{ marginTop: "var(--s-3)" }}>
            <div className="section-label">Agent runs</div>
            {intents.length === 0 ? (
              <div className="surface-card text-muted" style={{ fontSize: "0.85rem" }}>
                No agent runs yet. Create a policy and schedule a payment — each
                run the executor settles will appear here with its tx and gas mode.
              </div>
            ) : (
              intents.map((run) => <RunCard key={run.id} run={run} />)
            )}
          </section>

          {/* Receipts */}
          <section className="tight-stack" style={{ marginTop: "var(--s-4)" }}>
            <div className="section-label">Receipt registry</div>
            {receipts.length === 0 ? (
              <div className="surface-card text-muted" style={{ fontSize: "0.85rem" }}>
                No on-chain receipts yet.
              </div>
            ) : (
              receipts.map((r) => <ReceiptRow key={r.receiptId} r={r} />)
            )}
          </section>
        </>
      )}

      {/* Pipeline reference */}
      <section className="surface-card tight-stack" style={{ marginTop: "var(--s-4)" }}>
        <h3>How a run flows</h3>
        {[
          ["Watcher", "Finds due intents and re-reads the policy"],
          ["Strategist", "Selects the gas mode before submit"],
          ["Guardian", "Enforces on-chain caps, recipient scope, expiry"],
          ["Executor", "Submits the scoped session-key UserOp"],
          ["Receipt", "Writes the audit trail after settlement"],
        ].map(([label, value]) => (
          <div className="activity-flow-row" key={label}>
            <span style={{ fontWeight: 700, color: "var(--text-pure)" }}>{label}</span>
            <span className="text-muted" style={{ fontSize: "0.8rem" }}>{value}</span>
          </div>
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ textAlign: "center", padding: "var(--s-2)" }}>
      <div style={{ fontWeight: 800, fontSize: "1.35rem" }}>{value}</div>
      <div className="text-muted" style={{ fontSize: "0.68rem" }}>{label}</div>
    </div>
  );
}

function RunCard({ run }: { run: AutopilotIntent }): React.ReactElement {
  const s = STATUS[run.status];
  const recurring = run.intervalSeconds !== null;
  return (
    <div className="surface-card tight-stack" style={{ gap: "var(--s-2)" }}>
      <div className="flex-between" style={{ gap: "var(--s-2)" }}>
        <span style={{ fontWeight: 700 }}>
          ${fmtAmount(run.amount)} <span className="text-muted" style={{ fontWeight: 500 }}>QUSDC</span>
        </span>
        <span className={`chip ${s.chip}`}>{s.label}</span>
      </div>

      <div className="activity-meta">
        <span className="text-muted">To</span>
        <span className="mono">{short(run.recipient)}</span>
      </div>
      <div className="activity-meta">
        <span className="text-muted">Runs</span>
        <span>{run.runsCompleted}/{run.maxRuns}{recurring ? " · recurring" : ""}</span>
      </div>
      {run.lastGasMode !== undefined && (
        <div className="activity-meta">
          <span className="text-muted">Gas</span>
          <span>{GAS_LABEL[run.lastGasMode] ?? run.lastGasMode}</span>
        </div>
      )}
      <div className="activity-meta">
        <span className="text-muted">{run.status === "scheduled" ? "Next run" : "Updated"}</span>
        <span>{fmtTime(run.nextRunAt)}</span>
      </div>

      {run.lastTxHash !== undefined && (
        <a
          className="history-link"
          href={`${EXPLORER}/tx/${run.lastTxHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View last transaction →
        </a>
      )}
      {run.lastError !== undefined && (
        <div className="alert alert-error" style={{ fontSize: "0.78rem" }}>{run.lastError}</div>
      )}
    </div>
  );
}

function ReceiptRow({ r }: { r: QevieReceipt }): React.ReactElement {
  return (
    <Link to={`/receipt/${r.receiptId}`} style={{ textDecoration: "none" }}>
      <div className="surface-card activity-receipt">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text-pure)" }}>
            {RECEIPT_LABEL[r.receiptType] ?? "Receipt"}
          </div>
          <div className="text-muted" style={{ fontSize: "0.7rem" }}>{fmtTime(r.timestamp)}</div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ fontWeight: 700, color: "var(--accent-light)" }}>
            {r.amount === null ? "Private" : `$${r.amount}`}
          </div>
          <div className="text-muted mono" style={{ fontSize: "0.66rem" }}>{short(r.payee)}</div>
        </div>
      </div>
    </Link>
  );
}
