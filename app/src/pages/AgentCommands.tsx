import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { APP_CONFIG } from "../config.js";
import {
  buildAgentCommand,
  type AgentCommandResult,
  type ResolvedLeg,
} from "../lib/agentCommands.js";

const EXAMPLES = [
  "Pay alice 5 QUSDC",
  "Pay Ada 5 QUSDC and Sam 8 QUSDC",
  "Request 15 QUSDC from tobi for lunch",
  "Create a payment link for 30 QUSDC for design work",
  "Pay designer.qie 10 QUSDC every Friday for 4 weeks",
];

const TOOL_LABEL: Record<string, string> = {
  send_qusdc: "Send",
  batch_pay_qusdc: "Batch",
  create_payment_link: "Payment Link",
  create_payment_request: "Request",
  create_subscription: "Subscription",
  create_receipt: "Receipt",
  read_passport: "Passport",
};

export default function AgentCommands(): React.ReactElement {
  const client = useQevieClient();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string): Promise<void> => {
    if (text.trim() === "") return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await buildAgentCommand(client, APP_CONFIG.appBaseUrl, text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not interpret that command.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Agent native</div>
          <h2 className="page-title">Agent Commands</h2>
        </div>
      </div>

      <p className="text-muted" style={{ fontSize: "0.875rem" }}>
        Tell Qevie what should happen. Autopilot chooses the right rail; your
        smart account policy enforces the boundary.
      </p>

      <div className="input-group" style={{ marginTop: "var(--s-3)" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Pay designer.qie 10 QUSDC every Friday for 4 weeks"
          rows={3}
          autoCapitalize="none"
          spellCheck={false}
          style={{ width: "100%", resize: "vertical", padding: "0.75rem" }}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "var(--s-3)" }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="chip"
            onClick={() => { setInput(ex); void run(ex); }}
            style={{ cursor: "pointer", fontSize: "0.7rem" }}
          >
            {ex}
          </button>
        ))}
      </div>

      <button
        className="btn-primary btn-lg"
        disabled={busy || input.trim() === ""}
        onClick={() => { void run(input); }}
      >
        {busy ? "Interpreting…" : "Interpret command"}
      </button>

      {error !== null && <div className="alert alert-error" style={{ marginTop: "var(--s-3)" }}>{error}</div>}

      {result?.kind === "clarification" && (
        <div className="alert alert-info" style={{ marginTop: "var(--s-3)" }}>
          {result.question}
        </div>
      )}

      {result?.kind === "plan" && (
        <section className="surface-card tight-stack" style={{ marginTop: "var(--s-3)" }}>
          <div className="flex-between">
            <h3>Planned rails</h3>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              {result.plan.tools.map((t, i) => (
                <span key={`${t}-${i}`} className="chip chip-accent" style={{ fontSize: "0.7rem" }}>
                  {TOOL_LABEL[t] ?? t}
                </span>
              ))}
            </div>
          </div>

          {result.plan.legs.length > 0 && (
            <div className="tight-stack">
              <div className="section-label">Recipients</div>
              {result.plan.legs.map((leg) => (
                <RecipientRow key={leg.input} leg={leg} />
              ))}
            </div>
          )}

          {result.plan.linkUrl !== undefined && (
            <div className="tight-stack">
              <div className="section-label">Generated payment link</div>
              <code className="mono" style={{ wordBreak: "break-all", fontSize: "0.75rem" }}>
                {result.plan.linkUrl}
              </code>
              <button
                className="btn-secondary"
                onClick={() => { void navigator.clipboard?.writeText(result.plan.linkUrl ?? ""); }}
              >
                Copy link
              </button>
            </div>
          )}

          {result.plan.blocked ? (
            <div className="alert alert-error">
              Cannot execute: {result.plan.blockReason}
              <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
                A QIE Domain must resolve before it can be paid.
              </div>
            </div>
          ) : result.plan.manualHref !== undefined ? (
            <div className="autopilot-actions">
              <Link className="btn btn-primary" to={result.plan.manualHref}>
                Run manually
              </Link>
              {result.plan.policyHref !== undefined && (
                <Link className="btn btn-secondary" to={result.plan.policyHref}>
                  Create policy
                </Link>
              )}
            </div>
          ) : null}

          <p className="text-muted" style={{ fontSize: "0.75rem" }}>
            Qevie maps the command to a rail. In manual mode you approve it; in
            Autopilot it runs only if an onchain policy allows it.
          </p>
        </section>
      )}
    </main>
  );
}

function RecipientRow({ leg }: { leg: ResolvedLeg }): React.ReactElement {
  if (leg.resolved === undefined) {
    return (
      <div className="autopilot-status-row">
        <span className="mono">{leg.input}</span>
        <span className="status-warn">Unresolved</span>
      </div>
    );
  }
  const { resolved } = leg;
  const sourceLabel =
    resolved.source === "qie_domain_resolver"
      ? "QIE Domain Resolver"
      : resolved.source === "qevie_username_registry"
        ? "Qevie username"
        : "Direct address";
  return (
    <div className="surface-card" style={{ padding: "0.6rem 0.75rem" }}>
      <div className="flex-between">
        <span style={{ fontWeight: 700 }}>{resolved.displayName ?? leg.input}</span>
        {resolved.kind === "qie_domain" && (
          <span className={resolved.verified ? "chip chip-success" : "chip"} style={{ fontSize: "0.65rem" }}>
            {resolved.verified ? "Verified .qie" : "Unverified"}
          </span>
        )}
      </div>
      <div className="text-muted mono" style={{ fontSize: "0.7rem", wordBreak: "break-all" }}>
        {resolved.address}
      </div>
      <div className="text-muted" style={{ fontSize: "0.65rem" }}>{sourceLabel}</div>
    </div>
  );
}
