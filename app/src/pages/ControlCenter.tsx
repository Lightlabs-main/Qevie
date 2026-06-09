import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { getAutopilotGasStatus, type AutopilotGasStatus } from "../lib/autopilot.js";

const LOOP = [
  { name: "Watcher", desc: "finds due obligations." },
  { name: "Strategist", desc: "composes payment workflows." },
  { name: "Guardian", desc: "validates policy, risk, gas, and recipient scope." },
  { name: "Executor", desc: "submits scoped session-key UserOps." },
  { name: "Receipt / Passport", desc: "writes the audit trail and history." },
];

interface Snapshot {
  activePolicies: number;
  sessionKeys: number;
  gas: AutopilotGasStatus | null;
}

export default function ControlCenter(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const [snap, setSnap] = useState<Snapshot>({ activePolicies: 0, sessionKeys: 0, gas: null });

  useEffect(() => {
    if (address === null) return;
    let mounted = true;
    void (async () => {
      const [policies, gas] = await Promise.all([
        client.agent.listSessionPolicies(address).catch(() => []),
        getAutopilotGasStatus(client, address).catch(() => null),
      ]);
      if (!mounted) return;
      const active = policies.filter((p) => p.active && !p.guardianRevoked);
      const keys = new Set(active.map((p) => p.sessionKey.toLowerCase()));
      setSnap({ activePolicies: active.length, sessionKeys: keys.size, gas });
    })();
    return () => { mounted = false; };
  }, [address, client]);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Agent-native QUSDC execution on QIE</div>
          <h2 className="page-title">Qevie Autopilot</h2>
        </div>
        <span className={`chip ${snap.gas?.status === "active" ? "chip-success" : ""}`}>
          {snap.gas?.status === "active" ? "Active" : "Standby"}
        </span>
      </div>

      <section className="glass-card autopilot-hero">
        <h3>Policies in. Autonomous QUSDC execution out.</h3>
        <p className="text-muted">
          Create policies once, then let scoped agents execute payment workflows
          inside smart-account limits. Manual rails remain available as fallback.
        </p>
        <div className="autopilot-actions">
          <Link className="btn btn-primary" to="/agent">Open Agent Commands</Link>
          <Link className="btn btn-secondary" to="/autopilot/new">Create policy</Link>
        </div>
      </section>

      <section className="tight-grid" style={{ marginTop: "var(--s-4)" }}>
        <Stat label="Active Policies" value={String(snap.activePolicies)} to="/autopilot/policies" />
        <Stat label="Session Keys" value={String(snap.sessionKeys)} to="/autopilot/policies" />
        <Stat
          label="Gas Route Status"
          value={snap.gas === null ? "—" : snap.gas.status === "active" ? "Ready" : "Paused"}
          to="/autopilot"
        />
        <Stat label="Due Obligations" value="View" to="/subscriptions" />
        <Stat label="Pending Agent Commands" value="Open" to="/agent" />
        <Stat label="Guardian Checks" value="Policies" to="/autopilot/policies" />
        <Stat label="Recent UserOps" value="Activity" to="/autopilot/activity" />
        <Stat label="ReceiptRegistry Logs" value="History" to="/history" />
        <Stat label="Passport Updates" value="Passport" to="/passport" />
      </section>

      <section className="tight-stack" style={{ marginTop: "var(--s-4)" }}>
        <div className="section-label">Agent loop</div>
        <div className="surface-card" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Watcher → Strategist → Guardian → Executor → Receipt / Passport
        </div>
        <div className="autopilot-pipeline">
          {LOOP.map((stage, i) => (
            <React.Fragment key={stage.name}>
              <div className="surface-card autopilot-stage" style={{ alignItems: "flex-start" }}>
                <span>{i + 1}</span>
                <div>
                  <strong>{stage.name}</strong>
                  <div className="text-muted" style={{ fontSize: "0.7rem" }}>{stage.desc}</div>
                </div>
              </div>
              {i < LOOP.length - 1 && <div className="pipeline-arrow">↓</div>}
            </React.Fragment>
          ))}
        </div>
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
