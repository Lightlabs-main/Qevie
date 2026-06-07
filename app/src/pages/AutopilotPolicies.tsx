import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatUnits } from "viem";
import type { AgentPolicy } from "@qevie/sdk";
import { useQevieClient } from "@qevie/sdk/react";
import { APP_CONFIG } from "../config.js";
import { useWallet } from "../hooks/useWallet.js";

export default function AutopilotPolicies(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const manager = APP_CONFIG.agentPolicyManager;
  const [policies, setPolicies] = useState<AgentPolicy[]>([]);
  const [loading, setLoading] = useState(manager !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (manager === undefined || address === null) return;
    let mounted = true;
    void client.agent.listSessionPolicies(address)
      .then((items) => {
        if (mounted) setPolicies(items);
      })
      .catch((failure) => {
        if (mounted) setError(failure instanceof Error ? failure.message : "Failed to load policies.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [address, client, manager]);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">On-chain controls</div>
          <h2 className="page-title">Autopilot Policies</h2>
        </div>
        <Link className="btn btn-primary btn-sm" to="/autopilot/new">New</Link>
      </div>

      {manager === undefined ? (
        <Empty title="No policy manager configured" text="A verified AgentPolicyManager is required." />
      ) : loading ? (
        <div className="flex-center"><span className="spinner spinner-lg" /></div>
      ) : error !== null ? (
        <div className="alert alert-error">{error}</div>
      ) : policies.length === 0 ? (
        <Empty title="No Autopilot policies" text="Create a scoped session policy for this smart account." />
      ) : (
        <div className="tight-stack">
          {policies.map((policy) => (
            <section className="surface-card tight-stack" key={policy.policyId}>
              <div className="flex-between">
                <strong>{short(policy.policyId)}</strong>
                <span className={policy.active ? "status-good" : "status-warn"}>
                  {policy.guardianRevoked ? "Guardian revoked" : policy.active ? "Active" : "Revoked"}
                </span>
              </div>
              <Row label="Session key" value={short(policy.sessionKey)} />
              <Row label="Guardian" value={short(policy.guardian)} />
              <Row label="Max per tx" value={`${formatUnits(policy.maxPerTx, 6)} QUSDC`} />
              <Row label="Daily cap" value={`${formatUnits(policy.dailyLimit, 6)} QUSDC`} />
              <Row label="Weekly cap" value={`${formatUnits(policy.weeklyLimit, 6)} QUSDC`} />
              <Row label="Total cap" value={`${formatUnits(policy.totalLimit, 6)} QUSDC`} />
              <Row label="Spent total" value={`${formatUnits(policy.spentTotal, 6)} QUSDC`} />
              <Row label="Expires" value={new Date(Number(policy.validUntil) * 1000).toLocaleString()} />
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function Empty({ title, text }: { title: string; text: string }): React.ReactElement {
  return (
    <section className="surface-card tight-stack autopilot-empty">
      <div className="autopilot-empty-icon">A</div>
      <h3>{title}</h3>
      <p className="text-muted">{text}</p>
      <Link className="history-link" to="/autopilot">View Autopilot status</Link>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return <div className="autopilot-status-row"><span className="text-muted">{label}</span><strong>{value}</strong></div>;
}

function short(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
