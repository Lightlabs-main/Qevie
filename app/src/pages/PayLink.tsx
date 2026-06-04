import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parsePaymentUri } from "@qevie/sdk";
import type { ParsedPaymentLink } from "@qevie/sdk";

export default function PayLink(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<ParsedPaymentLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pay = searchParams.get("pay");
    if (pay === null) {
      setError("No payment link provided");
      return;
    }
    const result = parsePaymentUri(decodeURIComponent(pay));
    if (result === null) {
      setError("Invalid payment link");
      return;
    }
    setParsed(result);
  }, [searchParams]);

  function handlePay(): void {
    if (parsed === null) return;
    const params = new URLSearchParams();
    params.set("to", parsed.to);
    if (parsed.amount !== undefined) params.set("amount", (Number(parsed.amount) / 1e6).toString());
    if (parsed.memo) params.set("memo", parsed.memo);
    navigate(`/send?${params.toString()}`);
  }

  if (error !== null) {
    return (
      <main className="page">
        <p className="text-error">{error}</p>
        <button onClick={() => navigate("/")} style={{ marginTop: "1rem", width: "100%" }}>Go home</button>
      </main>
    );
  }

  if (parsed === null) {
    return (
      <main className="page" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
        <span className="spinner" />
      </main>
    );
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Payment request</h2>
      <div className="card" style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="text-muted">To</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>{parsed.to.slice(0, 10)}…</span>
        </div>
        {parsed.amount !== undefined && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="text-muted">Amount</span>
            <span style={{ fontWeight: 700, color: "var(--accent-light)" }}>
              ${(Number(parsed.amount) / 1e6).toFixed(2)} QUSDC
            </span>
          </div>
        )}
        {parsed.memo !== undefined && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="text-muted">Memo</span>
            <span>{parsed.memo}</span>
          </div>
        )}
      </div>
      <button onClick={handlePay} style={{ width: "100%" }}>
        Pay {parsed.amount !== undefined ? `$${(Number(parsed.amount) / 1e6).toFixed(2)}` : "now"}
      </button>
    </main>
  );
}
