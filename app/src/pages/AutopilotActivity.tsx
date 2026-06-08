import React from "react";
import { Link } from "react-router-dom";

export default function AutopilotActivity(): React.ReactElement {
  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Audit trail</div>
          <h2 className="page-title">Autopilot Activity</h2>
        </div>
        <Link className="history-link" to="/autopilot">Back</Link>
      </div>

      <section className="surface-card tight-stack autopilot-empty">
        <div className="autopilot-empty-icon">0</div>
        <h3>Audit trail is still being wired</h3>
        <p className="text-muted">
          The executor, keeper, and receipt paths are live, but this page does not
          yet stream a full decision log from the service.
        </p>
      </section>

      <section className="surface-card tight-stack">
        <h3>Current pipeline</h3>
        {[
          ["Watcher", "Intent queue and policy fetch in service"],
          ["Reputation signal", "Paymaster quota and allowlist checks"],
          ["Strategist", "Gas-mode selection before submit"],
          ["Guardian", "On-chain policy caps and expiry"],
          ["Executor", "Session-key UserOperation submission"],
          ["Receipt / Passport", "Best-effort receipt issuance after settlement"],
        ].map(([label, value]) => (
          <div className="autopilot-status-row" key={label}>
            <span className="text-muted">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
