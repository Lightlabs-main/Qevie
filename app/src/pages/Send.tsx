import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import type { UserOpResult } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

type Step = "form" | "confirm" | "pending" | "done";

export default function Send(): React.ReactElement {
  const client = useQevieClient();
  const { signer } = useWallet();
  const navigate = useNavigate();

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [result, setResult] = useState<UserOpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null);

  async function handlePreview(): Promise<void> {
    if (!to.trim() || !amount.trim()) return;
    setError(null);

    try {
      const addr = await client.resolve(to.trim());
      if (addr === null) {
        setError(`Cannot resolve "${to}". Try a 0x address or registered username.`);
        return;
      }
      setResolvedAddr(addr);
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolution failed");
    }
  }

  async function handleSend(): Promise<void> {
    if (signer === null) { setError("Wallet not connected"); return; }
    setStep("pending");
    setError(null);

    try {
      const amountUnits = BigInt(Math.round(Number(amount) * 1e6));
      const res = await client.pay(signer, {
        to: to.trim(),
        amount: amountUnits,
        memo: memo.trim() || undefined,
        mode: "qusdc",
      });
      setResult(res);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setStep("confirm");
    }
  }

  if (step === "done" && result !== null) {
    return (
      <main className="page">
        <h2 style={{ marginBottom: "1.5rem" }}>Payment sent ✓</h2>
        <div className="card text-success" style={{ marginBottom: "1rem" }}>
          <p>Your QUSDC payment was sent successfully.</p>
        </div>
        {result.txHash !== null && (
          <a
            href={`${APP_CONFIG.chainId === 1990 ? "https://mainnet.qie.digital" : "https://testnet.qie.digital"}/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: "block", marginBottom: "1rem" }}
          >
            View on QIE Explorer →
          </a>
        )}
        <button onClick={() => navigate("/")} style={{ width: "100%" }}>
          Back to Home
        </button>
      </main>
    );
  }

  if (step === "pending") {
    return (
      <main className="page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
        <span className="spinner" style={{ width: 40, height: 40, borderWidth: 3, marginBottom: "1rem" }} />
        <p>Sending payment…</p>
        <p className="text-muted" style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
          Submitting UserOperation to bundler
        </p>
      </main>
    );
  }

  if (step === "confirm") {
    const amountNum = Number(amount);
    return (
      <main className="page">
        <button
          onClick={() => setStep("form")}
          style={{ background: "transparent", color: "var(--text-muted)", padding: "0.5rem 0", marginBottom: "1rem" }}
        >
          ← Back
        </button>
        <h2 style={{ marginBottom: "1.5rem" }}>Confirm payment</h2>
        <div className="card" style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Row label="To" value={resolvedAddr?.slice(0, 10) + "…" + resolvedAddr?.slice(-8)} />
          <Row label="Amount" value={`$${amountNum.toFixed(2)} QUSDC`} />
          {memo && <Row label="Memo" value={memo} />}
          <Row label="Gas" value="Charged in QUSDC (gasless)" />
        </div>
        {error !== null && <p className="text-error" style={{ marginBottom: "1rem" }}>{error}</p>}
        <button onClick={() => { void handleSend(); }} style={{ width: "100%" }}>
          Send ${amountNum.toFixed(2)} QUSDC
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Send QUSDC</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            To (address, username, or name.qie)
          </label>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="alice.qie or 0x..."
            autoComplete="off"
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Amount (USD)
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Memo (optional)
          </label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Coffee ☕"
            maxLength={31}
          />
        </div>
        {error !== null && <p className="text-error">{error}</p>}
        <button
          onClick={() => { void handlePreview(); }}
          disabled={!to.trim() || !amount.trim()}
          style={{ width: "100%" }}
        >
          Preview
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | undefined }): React.ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="text-muted">{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
