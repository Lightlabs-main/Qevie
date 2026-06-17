import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatUnits } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import type { SubscriptionRecord } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { gaslessParams } from "../lib/gasless.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";
import BackButton from "../components/BackButton.js";
import {
  frequencyLabel,
  isCancellable,
  loadSubscriptionsFor,
  subStatus,
} from "../lib/subscriptions.js";

const PERIOD_PRESETS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Monthly", days: 30 },
];

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Unix seconds → value string for a <input type="datetime-local"> (local time). */
function toLocalDatetimeInput(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Subscriptions(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();
  const gasStatus = useGasStatus(client, signer, address);

  const [params] = useSearchParams();
  const prefillPeriod = Number(params.get("periodDays"));
  // Agent commands like "pay … every friday" carry a first-charge anchor so the
  // subscription doesn't charge immediately on the day it's created.
  const prefillStartAt = Number(params.get("startAt"));
  const startAtParam =
    Number.isFinite(prefillStartAt) && prefillStartAt > 0 ? prefillStartAt : null;
  const [payee, setPayee] = useState(params.get("payee") ?? "");
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [periodDays, setPeriodDays] = useState(
    Number.isFinite(prefillPeriod) && prefillPeriod > 0 ? prefillPeriod : 30,
  );
  const [maxPayments, setMaxPayments] = useState(params.get("maxPayments") ?? "12");
  // Explicit first-charge date. Empty = charge now. Prefilled from an agent
  // command's weekday anchor (e.g. "every friday") so the date is visible and
  // editable instead of silently defaulting to today.
  const [firstCharge, setFirstCharge] = useState(
    startAtParam !== null ? toLocalDatetimeInput(startAtParam) : "",
  );
  const minFirstCharge = toLocalDatetimeInput(Math.floor(Date.now() / 1000) + 60);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subs, setSubs] = useState<SubscriptionRecord[] | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const refreshSubs = useCallback(async (): Promise<void> => {
    if (address === null) { setSubs([]); return; }
    try { setSubs(await loadSubscriptionsFor(client, address)); }
    catch { setSubs([]); }
  }, [client, address]);

  useEffect(() => { void refreshSubs(); }, [refreshSubs]);

  const handleCancel = async (subId: bigint): Promise<void> => {
    if (signer === null) { setError("Wallet not connected"); return; }
    setCancelingId(subId.toString()); setError(null);
    try {
      await client.cancelSubscription(signer, subId);
      await refreshSubs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel subscription");
    } finally { setCancelingId(null); }
  };

  const handleSubscribe = async (): Promise<void> => {
    if (signer === null || address === null) { setError("Wallet not connected"); return; }
    setLoading(true); setError(null);
    try {
      const gas = await gaslessParams(client, address);
      const startAt = firstCharge
        ? Math.floor(new Date(firstCharge).getTime() / 1000)
        : undefined;
      await client.subscribe(signer, {
        payee: payee.trim(),
        amount: BigInt(Math.round(parseFloat(amount) * 1e6)),
        period: periodDays * 86400,
        maxPayments: parseInt(maxPayments),
        ...(startAt !== undefined ? { startAt } : {}),
        ...gas,
      });
      void refreshSubs();
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create subscription");
    } finally { setLoading(false); }
  };

  if (success) {
    return (
      <main className="page fade-in">
        <div style={{ textAlign: "center", paddingTop: "2rem" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🔄</div>
          <h1 style={{ marginBottom: "0.5rem" }}>Subscription active!</h1>
          <p className="text-muted" style={{ maxWidth: 300, margin: "0 auto" }}>
            ${parseFloat(amount).toFixed(2)} will be charged every {periodDays} day{periodDays === 1 ? "" : "s"}, automatically and gaslessly.
            {firstCharge !== "" && (
              <> First charge on {new Date(firstCharge).toLocaleDateString()}.</>
            )}
          </p>
          <button className="btn-secondary btn-lg" onClick={() => { setSuccess(false); setPayee(""); setAmount(""); }} style={{ marginTop: "2rem" }}>
            Create another
          </button>
        </div>
      </main>
    );
  }

  const totalCommitment = (parseFloat(amount) || 0) * (parseInt(maxPayments) || 0);

  return (
    <main className="page fade-in">
      <div className="page-header">
        <BackButton />
        <h2 className="page-title">Recurring Payment</h2>
      </div>
      <p className="text-muted mb-4" style={{ fontSize: "0.8125rem" }}>
        Authorize automatic QUSDC payments on a schedule. Cancel anytime.
      </p>

      {address !== null && (
        <SubscriptionList
          subs={subs}
          cancelingId={cancelingId}
          onCancel={(subId) => { void handleCancel(subId); }}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="input-group">
          <label className="input-label">Pay to</label>
          <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="address or username" autoCapitalize="none" />
        </div>

        <div className="input-group">
          <label className="input-label">Amount per cycle</label>
          <div style={{ position: "relative" }}>
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ paddingRight: "5rem" }} />
            <span className="input-suffix">QUSDC</span>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Frequency</label>
          <div className="toggle-group">
            {PERIOD_PRESETS.map((p) => (
              <button key={p.days} className={`toggle-btn ${periodDays === p.days ? "active" : ""}`} onClick={() => setPeriodDays(p.days)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">
            First charge <span className="text-dim">(optional, defaults to now)</span>
          </label>
          <input
            type="datetime-local"
            value={firstCharge}
            min={minFirstCharge}
            onChange={(e) => setFirstCharge(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Number of payments</label>
          <input type="number" min="1" value={maxPayments} onChange={(e) => setMaxPayments(e.target.value)} />
        </div>

        {totalCommitment > 0 && (
          <div className="card flex-between">
            <span className="text-muted">Total commitment</span>
            <span style={{ fontWeight: 700 }}>${totalCommitment.toFixed(2)}</span>
          </div>
        )}

        {error !== null && <div className="alert alert-error">{error}</div>}

        <GasStatusPanel status={gasStatus} />

        <button
          className="btn-primary btn-lg"
          onClick={() => { void handleSubscribe(); }}
          disabled={
            !payee.trim() ||
            !amount.trim() ||
            loading ||
            gasStatus.uiMode === "NEEDS_QUSDC" ||
            gasStatus.arming
          }
          style={{ marginTop: "0.5rem" }}
        >
          {loading ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Creating…</> : "Create subscription"}
        </button>
      </div>
    </main>
  );
}

function SubscriptionList({
  subs,
  cancelingId,
  onCancel,
}: {
  subs: SubscriptionRecord[] | null;
  cancelingId: string | null;
  onCancel(subId: bigint): void;
}): React.ReactElement | null {
  if (subs === null) {
    return (
      <div className="card" style={{ marginBottom: "1.25rem", display: "flex", justifyContent: "center", padding: "1.25rem" }}>
        <span className="spinner" style={{ width: 20, height: 20 }} />
      </div>
    );
  }
  if (subs.length === 0) return null;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label" style={{ marginBottom: "0.5rem" }}>Your subscriptions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {subs.map((sub) => {
          const status = subStatus(sub);
          const canCancel = isCancellable(sub);
          const busy = cancelingId === sub.subId.toString();
          return (
            <section className="surface-card tight-stack" key={sub.subId.toString()}>
              <div className="flex-between">
                <strong>${formatUnits(sub.amount, 6)} {frequencyLabel(Number(sub.period))}</strong>
                <span className={status.cls}>{status.label}</span>
              </div>
              <SubRow label="To" value={short(sub.payee)} />
              <SubRow
                label="Payments"
                value={`${sub.paymentsMade.toString()} of ${sub.maxPayments.toString()} made`}
              />
              {sub.active && (
                <SubRow
                  label="Next charge"
                  value={new Date(Number(sub.nextChargeAt) * 1000).toLocaleString()}
                />
              )}
              {canCancel && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onCancel(sub.subId)}
                  style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
                >
                  {busy ? "Cancelling…" : "Cancel subscription"}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SubRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex-between" style={{ fontSize: "0.8125rem" }}>
      <span className="text-muted">{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
