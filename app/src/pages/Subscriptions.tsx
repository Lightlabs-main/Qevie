import React, { useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";

export default function Subscriptions(): React.ReactElement {
  const client = useQevieClient();
  const { signer } = useWallet();

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("30");
  const [maxPayments, setMaxPayments] = useState("12");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe(): Promise<void> {
    if (signer === null) { setError("Wallet not connected"); return; }
    setIsLoading(true);
    setError(null);

    try {
      await client.subscribe(signer, {
        payee: payee.trim(),
        amount: BigInt(Math.round(Number(amount) * 1e6)),
        period: Number(period) * 86400,
        maxPayments: Number(maxPayments),
        mode: "qusdc",
      });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create subscription");
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <main className="page">
        <h2 style={{ marginBottom: "1.5rem" }}>Subscription created ✓</h2>
        <div className="card text-success" style={{ marginBottom: "1rem" }}>
          <p>Your recurring payment has been set up. The keeper will auto-charge on schedule.</p>
        </div>
        <button onClick={() => setSuccess(false)} style={{ width: "100%" }}>
          Set up another
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Recurring Payment</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Pay to
          </label>
          <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="address or username" />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Amount per period (USD)
          </label>
          <input type="number" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Period (days)
          </label>
          <input type="number" min="1" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Max payments
          </label>
          <input type="number" min="1" value={maxPayments} onChange={(e) => setMaxPayments(e.target.value)} />
        </div>
        {error !== null && <p className="text-error">{error}</p>}
        <button
          onClick={() => { void handleSubscribe(); }}
          disabled={!payee.trim() || !amount.trim() || isLoading}
          style={{ width: "100%" }}
        >
          {isLoading ? <span className="spinner" /> : "Create subscription"}
        </button>
      </div>
    </main>
  );
}
