import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import type { AgentPolicy } from "@qevie/sdk";
import { useQevieClient } from "@qevie/sdk/react";
import { APP_CONFIG } from "../config.js";
import { useWallet } from "../hooks/useWallet.js";
import {
  cancelIntent,
  listIntents,
  scheduleIntent,
  type AutopilotIntent,
} from "../lib/autopilotIntents.js";

const FREQUENCY_OPTIONS: { label: string; intervalSeconds: number | null }[] = [
  { label: "One time", intervalSeconds: null },
  { label: "Every day", intervalSeconds: 86_400 },
  { label: "Every week", intervalSeconds: 604_800 },
  { label: "Every month", intervalSeconds: 2_592_000 },
];

export default function AutopilotPolicies(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const manager = APP_CONFIG.agentPolicyManager;
  const [policies, setPolicies] = useState<AgentPolicy[]>([]);
  const [intents, setIntents] = useState<AutopilotIntent[]>([]);
  const [loading, setLoading] = useState(manager !== undefined);
  const [error, setError] = useState<string | null>(null);

  const refreshIntents = useCallback(async (): Promise<void> => {
    if (address === null) return;
    try {
      setIntents(await listIntents(address));
    } catch {
      /* leave intents as-is; the policies still render */
    }
  }, [address]);

  useEffect(() => {
    if (manager === undefined || address === null) return;
    let mounted = true;
    void Promise.all([client.agent.listSessionPolicies(address), listIntents(address).catch(() => [])])
      .then(([items, loadedIntents]) => {
        if (!mounted) return;
        setPolicies(items);
        setIntents(loadedIntents);
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
          <div className="section-label">Onchain controls</div>
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

              {policy.active && !policy.guardianRevoked && address !== null && (
                <ScheduleForm
                  policy={policy}
                  smartAccount={address}
                  onScheduled={() => { void refreshIntents(); }}
                />
              )}
            </section>
          ))}

          <IntentsList
            intents={intents}
            smartAccount={address}
            onChanged={() => { void refreshIntents(); }}
          />
        </div>
      )}
    </main>
  );
}

function ScheduleForm({
  policy,
  smartAccount,
  onScheduled,
}: {
  policy: AgentPolicy;
  smartAccount: Address;
  onScheduled(): void;
}): React.ReactElement {
  const recipientOptions = policy.recipients ?? [];
  const [recipient, setRecipient] = useState(recipientOptions[0] ?? "");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState(0);
  const [maxRuns, setMaxRuns] = useState("12");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      if (!isAddress(recipient)) throw new Error("Choose a valid recipient.");
      if (amount === "" || Number(amount) <= 0) throw new Error("Enter an amount greater than zero.");
      const option = FREQUENCY_OPTIONS[frequency] ?? FREQUENCY_OPTIONS[0]!;
      const recurring = option.intervalSeconds !== null;
      await scheduleIntent({
        smartAccount,
        policyId: policy.policyId,
        recipient: recipient as Address,
        amount: parseUnits(amount, 6),
        intervalSeconds: option.intervalSeconds,
        maxRuns: recurring ? Math.max(1, Number(maxRuns) || 1) : 1,
      });
      setMessage("Payment scheduled.");
      setAmount("");
      onScheduled();
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "Could not schedule the payment.");
    } finally {
      setBusy(false);
    }
  };

  const recurring = (FREQUENCY_OPTIONS[frequency]?.intervalSeconds ?? null) !== null;

  return (
    <div className="surface-card tight-stack">
      <h3>Schedule a payment</h3>
      <div className="input-group">
        <label className="input-label">Recipient</label>
        {recipientOptions.length > 0 ? (
          <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {recipientOptions.map((r) => <option key={r} value={r}>{short(r)}</option>)}
          </select>
        ) : (
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." />
        )}
      </div>
      <div className="tight-grid">
        <div className="input-group">
          <label className="input-label">Amount</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="input-group">
          <label className="input-label">Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(Number(e.target.value))}>
            {FREQUENCY_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {recurring && (
        <div className="input-group">
          <label className="input-label">Number of payments</label>
          <input type="number" value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />
        </div>
      )}
      {message !== null && (
        <div className={failed ? "alert alert-error" : "alert alert-info"}>{message}</div>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={() => { void submit(); }}>
        {busy ? "Scheduling..." : "Schedule"}
      </button>
    </div>
  );
}

function IntentsList({
  intents,
  smartAccount,
  onChanged,
}: {
  intents: AutopilotIntent[];
  smartAccount: Address | null;
  onChanged(): void;
}): React.ReactElement | null {
  if (intents.length === 0) return null;
  return (
    <section className="surface-card tight-stack">
      <h3>Scheduled payments</h3>
      {intents.map((intent) => (
        <div className="autopilot-status-row tight-stack" key={intent.id} style={{ display: "block" }}>
          <div className="flex-between">
            <strong>{formatUnits(BigInt(intent.amount), 6)} QUSDC → {short(intent.recipient)}</strong>
            <span className={statusClass(intent.status)}>{intent.status}</span>
          </div>
          <Row label="Schedule" value={scheduleLabel(intent)} />
          {intent.status === "scheduled" && (
            <Row label="Next run" value={new Date(intent.nextRunAt * 1000).toLocaleString()} />
          )}
          {intent.status === "confirming" && (
            <div className="alert alert-info">
              Submitted to the bundler and waiting for onchain confirmation.
            </div>
          )}
          {intent.lastGasMode !== undefined && (
            <div className="autopilot-status-row" style={{ fontSize: "0.75rem", opacity: 0.85 }}>
              <span>Gas</span>
              <span>{intent.lastGasMode === "QUSDC_GAS" ? "Paid in USDC" : "Sponsored onboarding"}</span>
            </div>
          )}
          {intent.lastTxHash !== undefined && (
            <a
              className="history-link"
              href={`https://testnet.qie.digital/tx/${intent.lastTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              Latest transaction
            </a>
          )}
          {intent.lastError !== undefined && intent.status !== "scheduled" && intent.status !== "confirming" && (
            <div className="alert alert-error">{intent.lastError}</div>
          )}
          {intent.status === "scheduled" && smartAccount !== null && (
            <button
              className="btn btn-sm"
              onClick={() => {
                void cancelIntent(intent.id, smartAccount).then(onChanged).catch(() => onChanged());
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function scheduleLabel(intent: AutopilotIntent): string {
  if (intent.intervalSeconds === null) return "One time";
  const everyDays = Math.round(intent.intervalSeconds / 86_400);
  const unit = everyDays === 1 ? "day" : everyDays === 7 ? "week" : everyDays === 30 ? "month" : `${everyDays} days`;
  return `every ${unit} · ${intent.runsCompleted}/${intent.maxRuns} done`;
}

function statusClass(status: AutopilotIntent["status"]): string {
  if (status === "completed") return "status-good";
  if (status === "failed") return "status-warn";
  if (status === "confirming") return "status-warn";
  return "text-muted";
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
