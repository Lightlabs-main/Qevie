import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parsePaymentUri } from "@qevie/sdk";
import BackButton from "../components/BackButton.js";

export default function Scan(): React.ReactElement {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleParse = (): void => {
    const parsed = parsePaymentUri(input.trim());
    if (parsed === null) { setError("That doesn't look like a valid Qevie link or QR code"); return; }
    const params = new URLSearchParams();
    params.set("to", parsed.to);
    if (parsed.amount !== undefined) params.set("amount", (Number(parsed.amount) / 1e6).toString());
    if (parsed.memo) params.set("memo", parsed.memo);
    navigate(`/send?${params.toString()}`);
  };

  return (
    <main className="page fade-in">
      <div className="page-header">
        <BackButton />
        <h2 className="page-title">Scan & Pay</h2>
      </div>

      {/* Camera placeholder */}
      <div className="card-elevated mb-4" style={{ textAlign: "center", padding: "2rem 1.5rem" }}>
        <div style={{
          width: "100%", aspectRatio: "1", maxWidth: 260, margin: "0 auto 1.25rem",
          background: "var(--bg)", border: "2px dashed var(--border-2)",
          borderRadius: "var(--radius-lg)", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem",
        }}>
          <div style={{ fontSize: "2.5rem" }}>📷</div>
          <p className="text-muted" style={{ maxWidth: 200, fontSize: "0.8125rem" }}>
            Install Qevie as an app for live camera QR scanning
          </p>
        </div>
        <span className="chip chip-accent">PWA camera access</span>
      </div>

      <div className="divider-with-text mb-4">or paste a link</div>

      <div className="input-group">
        <label className="input-label">Qevie link or QR text</label>
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          placeholder="qevie:alice.qie?amount=5000000"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      {error !== null && <div className="alert alert-error mt-3">{error}</div>}

      <button className="btn-primary btn-lg" onClick={handleParse} disabled={!input.trim()} style={{ marginTop: "1rem" }}>
        Open payment
      </button>
    </main>
  );
}
