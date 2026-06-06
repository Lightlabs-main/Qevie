import React, { useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import type { UserOpResult } from "@qevie/sdk";
import type { CreateReceiptResult } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";
import { gaslessParams } from "../lib/gasless.js";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

interface Row { to: string; amount: string; }

export default function BatchPay(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();

  const [rows, setRows] = useState<Row[]>([{ to: "", amount: "" }]);
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserOpResult | null>(null);
  const [receipts, setReceipts] = useState<CreateReceiptResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addRow = (): void => setRows((p) => [...p, { to: "", amount: "" }]);
  const removeRow = (i: number): void => setRows((p) => p.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Row, val: string): void =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const validRows = rows.filter((r) => r.to.trim() && parseFloat(r.amount) > 0);

  const handleSend = async (): Promise<void> => {
    if (signer === null || address === null) { setError("Wallet not connected"); return; }
    if (validRows.length === 0) { setError("Add at least one valid recipient"); return; }
    setLoading(true); setError(null);
    try {
      const gas = await gaslessParams(client, address);
      const res = await client.batchPay(signer, {
        recipients: validRows.map((r) => ({ to: r.to.trim(), amount: BigInt(Math.round(parseFloat(r.amount) * 1e6)) })),
        memo: memo.trim() || undefined, ...gas,
      });
      setResult(res);
      if (APP_CONFIG.contracts.receiptRegistry !== undefined && res.txHash !== null) {
        const txHash = res.txHash;
        const created = await Promise.allSettled(validRows.map((row) => client.createReceipt({
          payer: address,
          payee: row.to.trim() as `0x${string}`,
          token: APP_CONFIG.contracts.qusdc,
          amount: row.amount,
          amountPrivate: false,
          receiptType: "BATCH_PAYMENT",
          paymentReference: txHash,
          metadata: {
            memo: memo.trim() || null,
            source: "batch-flow",
            recipient: row.to.trim(),
            txHash,
          },
        })));
        setReceipts(created.flatMap((item) => item.status === "fulfilled" ? [item.value] : []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch payment failed");
    } finally { setLoading(false); }
  };

  if (result !== null) {
    return (
      <main className="page fade-in">
        <div style={{ textAlign: "center", paddingTop: "2rem" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
          <h1 style={{ marginBottom: "0.5rem" }}>Batch sent!</h1>
          <p className="text-muted">${total.toFixed(2)} QUSDC to {validRows.length} recipients</p>
          {result.txHash !== null && (
            <a href={`${EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noreferrer"
              className="chip chip-accent" style={{ display: "inline-flex", marginTop: "1.5rem", textDecoration: "none" }}>
              View transaction →
            </a>
          )}
          {receipts.length > 0 && (
            <p className="text-muted" style={{ marginTop: "0.75rem", fontSize: "0.8125rem" }}>
              {receipts.length} receipt{receipts.length === 1 ? "" : "s"} created for this batch.
            </p>
          )}
          <button className="btn-secondary btn-lg" onClick={() => { setResult(null); setRows([{ to: "", amount: "" }]); }} style={{ marginTop: "2rem" }}>
            New batch
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">Batch Payment</h2>
      </div>
      <p className="text-muted mb-4" style={{ fontSize: "0.8125rem" }}>
        Pay multiple recipients in one gasless transaction.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1rem" }}>
        {rows.map((row, i) => (
          <div key={i} className="card" style={{ padding: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontWeight: 700, width: 18 }}>{i + 1}</span>
            <input value={row.to} onChange={(e) => update(i, "to", e.target.value)} placeholder="Recipient"
              autoCapitalize="none" style={{ flex: 2, padding: "0.6rem 0.75rem" }} />
            <input type="number" min="0.01" step="0.01" value={row.amount}
              onChange={(e) => update(i, "amount", e.target.value)} placeholder="0.00"
              style={{ flex: 1, padding: "0.6rem 0.75rem" }} />
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} style={{
                background: "var(--error-dim)", color: "var(--error)", border: "none",
                width: 32, height: 32, borderRadius: 8, flexShrink: 0, padding: 0, fontSize: "1rem",
              }}>×</button>
            )}
          </div>
        ))}
      </div>

      <button className="btn-ghost" onClick={addRow} style={{ width: "100%", borderStyle: "dashed", marginBottom: "1rem" }}>
        + Add recipient
      </button>

      <div className="input-group mb-4">
        <label className="input-label">Memo <span className="text-dim">(optional)</span></label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Payroll, airdrop…" maxLength={31} />
      </div>

      <div className="card-gradient flex-between mb-4">
        <span className="text-muted">Total</span>
        <span style={{ fontWeight: 800, fontSize: "1.25rem", color: "var(--accent-light)" }}>${total.toFixed(2)}</span>
      </div>

      {error !== null && <div className="alert alert-error mb-3">{error}</div>}

      <button className="btn-primary btn-lg" onClick={() => { void handleSend(); }} disabled={loading || validRows.length === 0}>
        {loading ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Sending…</> : `Send to ${validRows.length || 0} recipient${validRows.length === 1 ? "" : "s"}`}
      </button>
    </main>
  );
}
