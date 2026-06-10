import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { getAutopilotGasStatus, type AutopilotGasStatus } from "../lib/autopilot.js";
import { listIntents, type AutopilotIntent } from "../lib/autopilotIntents.js";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

const RUN_STATUS: Record<AutopilotIntent["status"], { label: string; chip: string }> = {
  scheduled: { label: "Scheduled", chip: "chip-accent" },
  confirming: { label: "Confirming", chip: "chip-accent" },
  completed: { label: "Completed", chip: "chip-success" },
  failed: { label: "Failed", chip: "chip-error" },
  cancelled: { label: "Cancelled", chip: "chip-muted" },
};

interface Snapshot {
  activePolicies: number;
  sessionKeys: number;
  gas: AutopilotGasStatus | null;
  balance: bigint | null;
  runs: AutopilotIntent[];
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtUsd(base: bigint): string {
  return (Number(base) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ControlCenter(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const [snap, setSnap] = useState<Snapshot>({
    activePolicies: 0,
    sessionKeys: 0,
    gas: null,
    balance: null,
    runs: [],
  });

  useEffect(() => {
    if (address === null) return;
    let mounted = true;
    void (async () => {
      const [policies, gas, balance, runs] = await Promise.all([
        client.agent.listSessionPolicies(address).catch(() => []),
        getAutopilotGasStatus(client, address).catch(() => null),
        client.publicClient.readContract({
          address: APP_CONFIG.contracts.qusdc,
          abi: QUSDC_ABI,
          functionName: "balanceOf",
          args: [address],
        }).then((b) => b as bigint).catch(() => null),
        listIntents(address).catch(() => []),
      ]);
      if (!mounted) return;
      const active = policies.filter((p) => p.active && !p.guardianRevoked);
      const keys = new Set(active.map((p) => p.sessionKey.toLowerCase()));
      setSnap({
        activePolicies: active.length,
        sessionKeys: keys.size,
        gas,
        balance,
        runs: [...runs].sort((a, b) => b.createdAt - a.createdAt),
      });
    })();
    return () => { mounted = false; };
  }, [address, client]);

  const recentRuns = snap.runs.slice(0, 4);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Agent native QUSDC execution on QIE</div>
          <h2 className="page-title">Qevie Autopilot</h2>
        </div>
        <span className={`chip ${snap.gas?.status === "active" ? "chip-success" : ""}`}>
          {snap.gas?.status === "active" ? "Active" : "Standby"}
        </span>
      </div>

      {/* Wallet: balance and quick access. */}
      <Link to="/wallet" className="glass-card wallet-card">
        <div className="wallet-card-main">
          <span className="section-label">Available balance</span>
          <div className="wallet-balance">
            <span className="wallet-balance-currency">$</span>
            <span className="wallet-balance-amount text-gradient">
              {snap.balance === null ? "0.00" : fmtUsd(snap.balance)}
            </span>
            <span className="wallet-balance-unit">QUSDC</span>
          </div>
          {address !== null && (
            <span className="wallet-card-address mono">{short(address)}</span>
          )}
        </div>
        <span className="wallet-card-cta" aria-hidden="true">›</span>
      </Link>

      <section className="glass-card autopilot-hero" style={{ marginTop: "var(--s-4)" }}>
        <h3>Policies in. Autonomous QUSDC execution out.</h3>
        <p className="text-muted">
          Create policies once, then let scoped agents execute payment workflows
          inside smart account limits.
        </p>
        <div className="autopilot-actions">
          <Link className="btn btn-primary" to="/agent">Agent Commands</Link>
          <Link className="btn btn-secondary" to="/autopilot/new">Create policy</Link>
        </div>
      </section>

      <section className="stat-row" style={{ marginTop: "var(--s-4)" }}>
        <Stat label="Active policies" value={String(snap.activePolicies)} to="/autopilot/policies" />
        <Stat label="Session keys" value={String(snap.sessionKeys)} to="/autopilot/policies" />
        <Stat
          label="Gas route"
          value={snap.gas === null ? "…" : snap.gas.status === "active" ? "Ready" : "Paused"}
          to="/autopilot"
        />
      </section>

      <nav className="quick-links" style={{ marginTop: "var(--s-3)" }}>
        {([
          ["Activity", "/autopilot/activity"],
          ["Policies", "/autopilot/policies"],
          ["Subscriptions", "/subscriptions"],
          ["History", "/history"],
          ["Passport", "/passport"],
        ] as const).map(([label, to]) => (
          <Link key={to} to={to} className="quick-link">{label}</Link>
        ))}
      </nav>

      {/* Live agent loop — real runs the executor settled, not a static diagram. */}
      <section className="tight-stack" style={{ marginTop: "var(--s-4)" }}>
        <div className="flex-between">
          <div className="section-label">Live agent runs</div>
          <Link className="history-link" to="/autopilot/activity">View all →</Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="surface-card text-muted" style={{ fontSize: "0.8rem" }}>
            No agent runs yet. Create a policy and schedule a payment — each run the
            executor settles streams here with its status, gas mode, and transaction.
          </div>
        ) : (
          recentRuns.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </section>

      <section className="tight-grid" style={{ marginTop: "var(--s-4)" }}>
        <Link className="surface-card autopilot-link" to="/rails">
          <strong>Manual Rails</strong>
          <span className="text-muted">Send · Batch · Links · QR · Requests · Subscriptions</span>
        </Link>
        <Link className="surface-card autopilot-link" to="/developers">
          <strong>Developers</strong>
          <span className="text-muted">SDK rails, tools, and resolver</span>
        </Link>
      </section>

      <div className="alert alert-info" style={{ marginTop: "var(--s-3)" }}>
        The AI can decide, but contracts enforce the boundaries. No custody. No
        unlimited agent access.
      </div>
    </main>
  );
}

function RunRow({ run }: { run: AutopilotIntent }): React.ReactElement {
  const s = RUN_STATUS[run.status];
  return (
    <div className="surface-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s-2)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          ${fmtUsd(BigInt(run.amount))} <span className="text-muted" style={{ fontWeight: 500, fontSize: "0.75rem" }}>QUSDC → {short(run.recipient)}</span>
        </div>
        <div className="text-muted" style={{ fontSize: "0.7rem", marginTop: "0.2rem" }}>
          {run.runsCompleted}/{run.maxRuns} runs
          {run.lastTxHash !== undefined && (
            <>
              {" · "}
              <a
                href={`${EXPLORER}/tx/${run.lastTxHash}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "var(--accent-light)" }}
              >
                tx
              </a>
            </>
          )}
        </div>
      </div>
      <span className={`chip ${s.chip}`} style={{ flexShrink: 0 }}>{s.label}</span>
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: string; to: string }): React.ReactElement {
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div className="surface-card" style={{ height: "100%" }}>
        <div className="text-muted" style={{ fontSize: "0.7rem" }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: "1.1rem", marginTop: "0.25rem" }}>{value}</div>
      </div>
    </Link>
  );
}
