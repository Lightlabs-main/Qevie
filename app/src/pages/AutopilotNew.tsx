import React, { useState } from "react";
import { Link } from "react-router-dom";
import { isAddress, parseUnits, type Address, type Hex } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { gaslessParams } from "../lib/gasless.js";

type GasFallback = "sponsored-qusdc" | "sponsored-pause" | "native";

export default function AutopilotNew(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();
  const configured = APP_CONFIG.agentPolicyManager !== undefined;
  const executionEnabled = APP_CONFIG.autopilotExecutionEnabled;
  const [gasFallback, setGasFallback] = useState<GasFallback>("sponsored-qusdc");
  const [sessionKey, setSessionKey] = useState("");
  const [guardian, setGuardian] = useState("");
  const [recipients, setRecipients] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("10");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [weeklyLimit, setWeeklyLimit] = useState("50");
  const [totalLimit, setTotalLimit] = useState("100");
  const [maxGas, setMaxGas] = useState("0.10");
  const [dailyGas, setDailyGas] = useState("1.00");
  const [validAfter, setValidAfter] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [allowSingle, setAllowSingle] = useState(true);
  const [allowBatch, setAllowBatch] = useState(false);
  const [allowRequest, setAllowRequest] = useState(false);
  const [allowSubscription, setAllowSubscription] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<Hex | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const createPolicy = async (): Promise<void> => {
    if (signer === null || address === null) {
      setError("Connect your wallet before creating a policy.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (!isAddress(sessionKey) || !isAddress(guardian)) {
        throw new Error("Session key and guardian must be valid addresses.");
      }
      const recipientList = recipients
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "");
      if (recipientList.length === 0 || recipientList.some((value) => !isAddress(value))) {
        throw new Error("Add at least one valid recipient address.");
      }
      if (!allowSingle && !allowBatch && !allowRequest && !allowSubscription) {
        throw new Error("Select at least one allowed action.");
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const after = validAfter === ""
        ? now
        : BigInt(Math.floor(new Date(validAfter).getTime() / 1000));
      if (validUntil === "") throw new Error("Expiry is required.");
      const until = BigInt(Math.floor(new Date(validUntil).getTime() / 1000));
      if (until <= after || until <= now) throw new Error("Expiry must be after the valid-from time.");

      const gas = await gaslessParams(client, address);
      const result = await client.agent.createSessionPolicy(signer, {
        sessionKey: sessionKey as Address,
        guardian: guardian as Address,
        recipients: recipientList as Address[],
        maxPerTx: parseUnits(maxPerTx, 6),
        dailyLimit: parseUnits(dailyLimit, 6),
        weeklyLimit: parseUnits(weeklyLimit, 6),
        totalLimit: parseUnits(totalLimit, 6),
        maxQusdcGasPerTx: parseUnits(maxGas, 6),
        dailyQusdcGasCap: parseUnits(dailyGas, 6),
        validAfter: after,
        validUntil: until,
        allowSinglePayment: allowSingle,
        allowBatchPayment: allowBatch,
        allowPaymentRequest: allowRequest,
        allowSubscription,
        allowSponsoredGas: gasFallback !== "native",
        allowQusdcGas: gasFallback === "sponsored-qusdc",
        allowNativeQieFallback: gasFallback === "native",
        pauseWhenGasUnavailable: gasFallback === "sponsored-pause",
      }, { mode: gas.mode });
      setPolicyId(result.policyId);
      setTxHash(result.result?.txHash ?? null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Policy creation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (policyId !== null) {
    return (
      <main className="page fade-in">
        <section className="surface-card tight-stack">
          <div className="section-label">Policy active</div>
          <h2>Autopilot policy created</h2>
          <p className="text-muted mono">{policyId}</p>
          {txHash !== null && (
            <a
              className="history-link"
              href={`https://testnet.qie.digital/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
            </a>
          )}
          <Link className="btn btn-primary" to="/autopilot/policies">View policies</Link>
        </section>
      </main>
    );
  }

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
        <Field label="Session key address" value={sessionKey} onChange={setSessionKey} placeholder="0x..." />
        <Field label="Guardian address" value={guardian} onChange={setGuardian} placeholder="0x..." />
        <Field label="Allowed recipients" value={recipients} onChange={setRecipients} placeholder="0x..., 0x..." />

        <div className="input-group">
          <label className="input-label">Token</label>
          <input value="QUSDC only" disabled />
        </div>

        <div className="tight-grid">
          <Field label="Max per tx" value={maxPerTx} onChange={setMaxPerTx} suffix="QUSDC" type="number" />
          <Field label="Daily cap" value={dailyLimit} onChange={setDailyLimit} suffix="QUSDC" type="number" />
          <Field label="Weekly cap" value={weeklyLimit} onChange={setWeeklyLimit} suffix="QUSDC" type="number" />
          <Field label="Total cap" value={totalLimit} onChange={setTotalLimit} suffix="QUSDC" type="number" />
        </div>

        <div className="tight-grid">
          <Field label="Valid from" value={validAfter} onChange={setValidAfter} type="datetime-local" />
          <Field label="Expiry" value={validUntil} onChange={setValidUntil} type="datetime-local" />
        </div>

        <section className="surface-card tight-stack">
          <h3>Allowed actions</h3>
          <Check label="Single payment" checked={allowSingle} onChange={setAllowSingle} />
          <Check label="Batch payment" checked={allowBatch} onChange={setAllowBatch} />
          <Check label="Payment request" checked={allowRequest} onChange={setAllowRequest} />
          <Check label="Subscription" checked={allowSubscription} onChange={setAllowSubscription} />
        </section>

        <section className="surface-card tight-stack">
          <h3>After sponsored quota is exhausted</h3>
          <SelectOption label="Sponsored then QUSDC Gas" value="sponsored-qusdc" selected={gasFallback} onSelect={setGasFallback} />
          <SelectOption label="Sponsored then pause" value="sponsored-pause" selected={gasFallback} onSelect={setGasFallback} />
          <SelectOption label="Native QIE only" value="native" selected={gasFallback} onSelect={setGasFallback} />
          <div className="tight-grid">
            <Field label="Max gas per tx" value={maxGas} onChange={setMaxGas} suffix="QUSDC" type="number" />
            <Field label="Daily gas cap" value={dailyGas} onChange={setDailyGas} suffix="QUSDC" type="number" />
          </div>
        </section>

        {!configured ? (
          <div className="alert alert-error">AgentPolicyManager is not configured for this chain.</div>
        ) : !executionEnabled ? (
          <div className="alert alert-info">Autopilot execution is not enabled for this deployment.</div>
        ) : null}
        {error !== null && <div className="alert alert-error">{error}</div>}

        <button
          className="btn-primary btn-lg"
          disabled={!configured || !executionEnabled || submitting}
          onClick={() => { void createPolicy(); }}
        >
          {submitting ? "Creating policy..." : "Create Autopilot Policy"}
        </button>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  type = "text",
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  suffix?: string;
  type?: string;
}): React.ReactElement {
  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={suffix ? { paddingRight: "5rem" } : undefined}
        />
        {suffix !== undefined && <span className="input-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}): React.ReactElement {
  return (
    <label className="autopilot-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
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
  value: GasFallback;
  selected: GasFallback;
  onSelect(value: GasFallback): void;
}): React.ReactElement {
  return (
    <label className="autopilot-check">
      <input type="radio" name="gas-fallback" checked={selected === value} onChange={() => onSelect(value)} />
      <span>{label}</span>
    </label>
  );
}
