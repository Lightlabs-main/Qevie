import React from "react";
import { Link } from "react-router-dom";
import { APP_CONFIG } from "../config.js";

export default function AutopilotPolicies(): React.ReactElement {
  const manager = APP_CONFIG.agentPolicyManager;

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
        <section className="surface-card tight-stack autopilot-empty">
          <div className="autopilot-empty-icon">A</div>
          <h3>No policy manager configured</h3>
          <p className="text-muted">
            Policies will appear here after AgentPolicyManager is deployed and verified
            for this chain.
          </p>
          <Link className="history-link" to="/autopilot">View Autopilot status</Link>
        </section>
      ) : (
        <section className="surface-card tight-stack">
          <h3>Policy manager connected</h3>
          <p className="text-muted">{manager}</p>
          <div className="alert alert-info">
            No session policies were found for this smart account.
          </div>
        </section>
      )}
    </main>
  );
}
