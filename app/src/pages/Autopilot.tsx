import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import {
  getAutopilotGasStatus,
  type AutopilotGasStatus,
} from "../lib/autopilot.js";

const PIPELINE = [
  "Watcher",
  "Reputation Oracle",
  "Strategist",
  "Guardian",
  "Executor",
  "Receipt / Passport",
];

export default function Autopilot(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const [gasStatus, setGasStatus] = useState<AutopilotGasStatus | null>(null);

  useEffect(() => {
    if (address === null) return;
    let mounted = true;
    void getAutopilotGasStatus(client, address).then((status) => {
      if (mounted) setGasStatus(status);
    });
    return () => { mounted = false; };
  }, [address, client]);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Autonomous payments</div>
          <h2 className="page-title">Qevie Autopilot</h2>
        </div>
        <span className={`chip ${gasStatus?.status === "active" ? "chip-success" : ""}`}>
          {gasStatus?.status === "active" ? "Active" : "Paused"}
        </span>
      </div>

      <section className="glass-card autopilot-hero">
        <h3>Agent-native QUSDC execution on QIE.</h3>
        <p className="text-muted">
          Create policies once, then let scoped agents execute payment workflows
          inside smart-account limits. Payment links, batch, requests, QR, and
          subscriptions become rails Autopilot can call — manual rails stay available.
        </p>
        <div className="autopilot-actions">
          <Link className="btn btn-primary" to="/agent">Agent Commands</Link>
          <Link className="btn btn-secondary" to="/autopilot/new">Create policy</Link>
        </div>
      </section>

      {gasStatus !== null && (
        <section className="surface-card tight-stack">
          <div className="flex-between">
            <h3>Autopilot Gas Status</h3>
            <span className={gasStatus.status === "active" ? "status-good" : "status-warn"}>
              {gasStatus.status === "active" ? "Ready" : "Paused"}
            </span>
          </div>
          <StatusRow label="Sponsored transactions used" value={`${gasStatus.sponsoredUsed} / 3`} />
          <StatusRow label="Sponsored remaining" value={`${gasStatus.sponsoredRemaining}`} />
          <StatusRow label="QUSDC Gas" value={gasStatus.qusdcGasConfigured ? "Available" : "Disabled"} />
          <StatusRow label="QIEDex route" value="WQIE -> QUSDC" />
          <p className="text-muted">{gasStatus.reason}</p>
        </section>
      )}

      <section className="tight-stack">
        <div className="section-label">Agent pipeline</div>
        <div className="autopilot-pipeline">
          {PIPELINE.map((stage, index) => (
            <React.Fragment key={stage}>
              <div className="surface-card autopilot-stage">
                <span>{index + 1}</span>
                <strong>{stage}</strong>
              </div>
              {index < PIPELINE.length - 1 && <div className="pipeline-arrow">↓</div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="tight-grid">
        <Link className="surface-card autopilot-link" to="/autopilot/policies">
          <strong>Policies</strong>
          <span className="text-muted">Caps, recipients, expiry, guardian</span>
        </Link>
        <Link className="surface-card autopilot-link" to="/autopilot/activity">
          <strong>Activity</strong>
          <span className="text-muted">Decisions, gas mode, receipts</span>
        </Link>
      </section>

      <div className="alert alert-info">
        The AI can decide, but contracts enforce the boundaries. No gas. No custody.
        No unlimited agent access.
      </div>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="autopilot-status-row">
      <span className="text-muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
