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
        <h3>No autonomous actions yet</h3>
        <p className="text-muted">
          Executed and vetoed decisions will show the policy ID, guardian result,
          gas mode, UserOperation hash, transaction hash, and receipt ID.
        </p>
      </section>

      <section className="surface-card tight-stack">
        <h3>Audit fields</h3>
        {[
          "Watcher decision",
          "Reputation signal",
          "Strategist rationale",
          "Guardian approval or veto",
          "Gas mode and sponsored quota",
          "UserOperation and transaction",
          "Receipt and Passport update",
        ].map((item) => (
          <div className="autopilot-status-row" key={item}>
            <span className="text-muted">{item}</span>
            <span>Pending</span>
          </div>
        ))}
      </section>
    </main>
  );
}
