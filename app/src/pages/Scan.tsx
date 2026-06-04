import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parsePaymentUri } from "@qevie/sdk";

export default function Scan(): React.ReactElement {
  const navigate = useNavigate();
  const [manualInput, setManualInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleManualParse(): void {
    const parsed = parsePaymentUri(manualInput.trim());
    if (parsed === null) {
      setError("Invalid payment URI or link");
      return;
    }
    const params = new URLSearchParams();
    if (parsed.to) params.set("to", parsed.to);
    if (parsed.amount !== undefined) params.set("amount", parsed.amount.toString());
    if (parsed.memo) params.set("memo", parsed.memo);
    navigate(`/send?${params.toString()}`);
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Scan / Pay</h2>

      <div className="card" style={{ marginBottom: "1.5rem", textAlign: "center" }}>
        <div
          style={{
            width: "100%",
            aspectRatio: "1",
            background: "var(--border)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1rem",
          }}
        >
          <div>
            <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📷</p>
            <p className="text-muted" style={{ fontSize: "0.875rem" }}>
              Camera QR scanning available in native PWA mode
            </p>
          </div>
        </div>
        <p className="text-muted" style={{ fontSize: "0.8rem" }}>
          Install Qevie as a PWA on your phone for camera access
        </p>
      </div>

      <div>
        <label
          style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}
        >
          Or paste a qevie: link or share URL
        </label>
        <input
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="qevie:alice.qie?amount=5000000"
        />
        {error !== null && (
          <p className="text-error" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
            {error}
          </p>
        )}
        <button
          onClick={handleManualParse}
          disabled={!manualInput.trim()}
          style={{ width: "100%", marginTop: "0.75rem" }}
        >
          Open payment
        </button>
      </div>
    </main>
  );
}
