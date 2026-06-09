import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { gaslessParams } from "../lib/gasless.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";

const PERIOD_PRESETS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Monthly", days: 30 },
];

export default function Subscriptions(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();
  const gasStatus = useGasStatus(client, signer, address);

  const [params] = useSearchParams();
  const prefillPeriod = Number(params.get("periodDays"));
  const [payee, setPayee] = useState(params.get("payee") ?? "");
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [periodDays, setPeriodDays] = useState(
    Number.isFinite(prefillPeriod) && prefillPeriod > 0 ? prefillPeriod : 30,
  );
  const [maxPayments, setMaxPayments] = useState(params.get("maxPayments") ?? "12");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async (): Promise<void> => {
    if (signer === null || address === null) { setError("Wallet not connected"); return; }
    setLoading(true); setError(null);
    try {
      const gas = await gaslessParams(client, address);
      await client.subscribe(signer, {
        payee: payee.trim(),
        amount: BigInt(Math.round(parseFloat(amount) * 1e6)),
        period: periodDays * 86400,
        maxPayments: parseInt(maxPayments),
        ...gas,
      });
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
        <h2 className="page-title">Recurring Payment</h2>
      </div>
      <p className="text-muted mb-4" style={{ fontSize: "0.8125rem" }}>
        Authorize automatic QUSDC payments on a schedule. Cancel anytime.
      </p>

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
