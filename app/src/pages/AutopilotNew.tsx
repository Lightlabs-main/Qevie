import React, { useState } from "react";
import { Link } from "react-router-dom";
import { APP_CONFIG } from "../config.js";

export default function AutopilotNew(): React.ReactElement {
  const configured = APP_CONFIG.agentPolicyManager !== undefined;
  const executionEnabled = APP_CONFIG.autopilotExecutionEnabled;
  const [gasFallback, setGasFallback] = useState("sponsored-qusdc");

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">New session policy</div>
          <h2 className="page-title">Create Autopilot Policy</h2>
        </div>
        <Link className="history-link" to="/autopilot">Back</Link>
      </div>

      <div className="alert alert-info">
        Session keys can spend only inside this policy. Expiry and finite limits are required.
        The guardian can revoke the policy on-chain.
      </div>

      <div className="tight-stack">
        <Field label="Policy name" placeholder="Operations agent" />
        <Field label="Session key address" placeholder="0x..." />
        <Field label="Guardian address" placeholder="0x..." />
        <Field label="Allowed recipients" placeholder="0x..., 0x..." />

        <div className="input-group">
          <label className="input-label">Token</label>
          <input value="QUSDC only" disabled />
        </div>

        <div className="tight-grid">
          <Field label="Max per tx" placeholder="10" suffix="QUSDC" type="number" />
          <Field label="Daily cap" placeholder="20" suffix="QUSDC" type="number" />
          <Field label="Weekly cap" placeholder="50" suffix="QUSDC" type="number" />
          <Field label="Total cap" placeholder="100" suffix="QUSDC" type="number" />
        </div>

        <div className="tight-grid">
          <Field label="Valid from" type="datetime-local" />
          <Field label="Expiry" type="datetime-local" />
        </div>

        <section className="surface-card tight-stack">
          <h3>Allowed actions</h3>
          <Check label="Single payment" defaultChecked />
          <Check label="Batch payment" />
          <Check label="Payment request" />
          <Check label="Subscription" />
        </section>

        <section className="surface-card tight-stack">
          <h3>After sponsored quota is exhausted</h3>
          <SelectOption
            label="Sponsored then QUSDC Gas"
            value="sponsored-qusdc"
            selected={gasFallback}
            onSelect={setGasFallback}
          />
          <SelectOption
            label="Sponsored then pause"
            value="sponsored-pause"
            selected={gasFallback}
            onSelect={setGasFallback}
          />
          <SelectOption
            label="Native QIE only"
            value="native"
            selected={gasFallback}
            onSelect={setGasFallback}
          />
          <div className="tight-grid">
            <Field label="Max gas per tx" placeholder="0.10" suffix="QUSDC" type="number" />
            <Field label="Daily gas cap" placeholder="1.00" suffix="QUSDC" type="number" />
          </div>
          <Check label="Pause if QIEDex quote is unavailable" defaultChecked />
        </section>

        {!configured ? (
          <div className="alert alert-error">
            AgentPolicyManager is not configured for this chain. Policy creation is disabled
            until a verified deployment is added as `VITE_AGENT_POLICY_MANAGER_ADDRESS`.
          </div>
        ) : !executionEnabled ? (
          <div className="alert alert-info">
            AgentPolicyManager is deployed at {APP_CONFIG.agentPolicyManager}. Policy creation
            remains disabled until session UserOp submission is enabled.
          </div>
        ) : null}

        <button className="btn-primary btn-lg" disabled={!configured || !executionEnabled}>
          Create Autopilot Policy
        </button>
      </div>
    </main>
  );
}
function Field({
  label,
  placeholder,
  suffix,
  type = "text",
}: {
  label: string;
  placeholder?: string;
  suffix?: string;
  type?: string;
}): React.ReactElement {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div style={{ position: "relative" }}>
        <input type={type} placeholder={placeholder} style={suffix ? { paddingRight: "5rem" } : undefined} />
        {suffix !== undefined && <span className="input-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function Check({ label, defaultChecked = false }: { label: string; defaultChecked?: boolean }): React.ReactElement {
  return (
    <label className="autopilot-check">
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

function SelectOption({
  label,
  value,
  selected,
  onSelect,
}: {
  label: string;
  value: string;
  selected: string;
  onSelect(value: string): void;
}): React.ReactElement {
  return (
    <label className="autopilot-check">
      <input
        type="radio"
        name="gas-fallback"
        checked={selected === value}
        onChange={() => onSelect(value)}
      />
      <span>{label}</span>
    </label>
  );
}
