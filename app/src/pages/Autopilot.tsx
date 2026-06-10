import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import {
  getAutopilotGasStatus,
  type AutopilotGasStatus,
} from "../lib/autopilot.js";
import AgentPipeline, { AGENT_STAGES } from "../components/AgentPipeline.js";
import { listIntents, type AutopilotIntent } from "../lib/autopilotIntents.js";

interface PipelineState {
  /** Index into AGENT_STAGES; -1 = idle. */
  stage: number;
  live: boolean;
  label?: string;
}

/** Derive which pipeline stage is acting right now from real intent state. */
function derivePipeline(intents: AutopilotIntent[]): PipelineState {
  const now = Math.floor(Date.now() / 1000);
  if (intents.some((i) => i.status === "confirming")) {
    return { stage: 3, live: true, label: "Submitting" };
  }
  if (intents.some((i) => i.status === "scheduled" && i.nextRunAt <= now)) {
    return { stage: 0, live: true, label: "Due now" };
  }
  if (intents.some((i) => i.status === "scheduled")) {
    return { stage: 0, live: false, label: "Armed" };
  }
  if (intents.some((i) => i.status === "completed" || i.lastTxHash !== undefined)) {
    return { stage: AGENT_STAGES.length - 1, live: false, label: "Settled" };
  }
  return { stage: -1, live: false };
}

export default function Autopilot(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const [gasStatus, setGasStatus] = useState<AutopilotGasStatus | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({ stage: -1, live: false });

  useEffect(() => {
    if (address === null) return;
    let mounted = true;
    void getAutopilotGasStatus(client, address).then((status) => {
      if (mounted) setGasStatus(status);
    });
    const refreshRuns = async (): Promise<void> => {
      const intents = await listIntents(address).catch(() => []);
      if (mounted) setPipeline(derivePipeline(intents));
    };
    void refreshRuns();
    // Poll so the pipeline reflects the loop acting in near-real time.
    const timer = setInterval(() => { void refreshRuns(); }, 10_000);
    return () => { mounted = false; clearInterval(timer); };
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
        <h3>Agent native QUSDC execution on QIE.</h3>
        <p className="text-muted">
          Create policies once, then let scoped agents execute payment workflows
          inside smart account limits. Payment links, batch, requests, QR, and
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

      <section className="surface-card tight-stack">
        <div className="flex-between">
          <div className="section-label">Agent pipeline</div>
          <span className={`chip ${pipeline.live ? "chip-accent" : pipeline.stage >= 0 ? "chip-success" : "chip-muted"}`}>
            {pipeline.live ? "Running" : pipeline.stage >= 0 ? "Armed" : "Idle"}
          </span>
        </div>
        <AgentPipeline activeStage={pipeline.stage} live={pipeline.live} activeLabel={pipeline.label} />
        {pipeline.stage < 0 && (
          <p className="text-muted" style={{ fontSize: "0.75rem" }}>
            The pipeline lights up as the loop acts — create a policy and schedule a
            payment, then each stage activates through to settlement.
          </p>
        )}
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
