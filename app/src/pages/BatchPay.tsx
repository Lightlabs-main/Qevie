import React, { useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import type { UserOpResult } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

interface RecipientRow {
  to: string;
  amount: string;
}

export default function BatchPay(): React.ReactElement {
  const client = useQevieClient();
  const { signer } = useWallet();

  const [rows, setRows] = useState<RecipientRow[]>([{ to: "", amount: "" }]);
  const [memo, setMemo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<UserOpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addRow(): void {
    setRows((prev) => [...prev, { to: "", amount: "" }]);
  }

  function removeRow(i: number): void {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof RecipientRow, value: string): void {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  const totalAmount = rows.reduce((sum, r) => {
    const n = Number(r.amount);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  async function handleSend(): Promise<void> {
    if (signer === null) { setError("Wallet not connected"); return; }
    const valid = rows.filter((r) => r.to.trim() && Number(r.amount) > 0);
    if (valid.length === 0) { setError("Add at least one valid recipient"); return; }

    setIsLoading(true);
    setError(null);

    try {
      const res = await client.batchPay(signer, {
        recipients: valid.map((r) => ({
          to: r.to.trim(),
          amount: BigInt(Math.round(Number(r.amount) * 1e6)),
        })),
        memo: memo.trim() || undefined,
        mode: "qusdc",
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch payment failed");
    } finally {
      setIsLoading(false);
    }
  }

  if (result !== null) {
    return (
      <main className="page">
        <h2 style={{ marginBottom: "1.5rem" }}>Batch sent ✓</h2>
        <div className="card text-success" style={{ marginBottom: "1rem" }}>
          <p>Batch payment of ${totalAmount.toFixed(2)} QUSDC sent successfully.</p>
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
        <button onClick={() => setResult(null)} style={{ width: "100%" }}>
          New batch
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Batch Payment</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              value={row.to}
              onChange={(e) => updateRow(i, "to", e.target.value)}
              placeholder="Recipient"
              style={{ flex: 2 }}
            />
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={row.amount}
              onChange={(e) => updateRow(i, "amount", e.target.value)}
              placeholder="USD"
              style={{ flex: 1 }}
            />
            {rows.length > 1 && (
              <button
                onClick={() => removeRow(i)}
                style={{ background: "transparent", color: "var(--error)", padding: "0.5rem", minWidth: 0 }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        style={{ background: "transparent", color: "var(--accent-light)", border: "1px dashed var(--border)", width: "100%", marginBottom: "1rem" }}
      >
        + Add recipient
      </button>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
          Memo (optional)
        </label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Payroll, airdrop…" maxLength={31} />
      </div>

      <div className="card" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
        <span className="text-muted">Total</span>
        <span style={{ fontWeight: 700 }}>${totalAmount.toFixed(2)} QUSDC</span>
      </div>

      {error !== null && <p className="text-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}
      <button
        onClick={() => { void handleSend(); }}
        disabled={isLoading || rows.filter((r) => r.to.trim() && Number(r.amount) > 0).length === 0}
        style={{ width: "100%" }}
      >
        {isLoading ? <span className="spinner" /> : `Send to ${rows.filter((r) => r.to.trim()).length} recipients`}
      </button>
    </main>
  );
}
