import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parsePaymentUri } from "@qevie/sdk";
import type { ParsedPaymentLink } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";

export default function PayLink(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { address, connect, isConnecting } = useWallet();

  const [parsed, setParsed] = useState<ParsedPaymentLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const pay = searchParams.get("pay");
    if (pay === null) { setError("No payment link provided"); return; }
    const result = parsePaymentUri(decodeURIComponent(pay));
    if (result === null) { setError("This payment link is invalid"); return; }
    if (result.expiry !== undefined && result.expiry * 1000 < Date.now()) {
      setExpired(true);
    }
    setParsed(result);
  }, [searchParams]);

  const handlePay = (): void => {
    if (parsed === null) return;
    const params = new URLSearchParams();
    params.set("to", parsed.to);
    if (parsed.amount !== undefined) params.set("amount", (Number(parsed.amount) / 1e6).toString());
    if (parsed.memo) params.set("memo", parsed.memo);
    navigate(`/send?${params.toString()}`);
  };

  if (error !== null) {
    return (
      <div className="flex-center" style={{ minHeight: "100dvh", padding: "2rem" }}>
        <div className="card-elevated fade-in" style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
          <h2 style={{ marginBottom: "0.5rem" }}>{error}</h2>
          <button className="btn-primary btn-lg" onClick={() => navigate("/")} style={{ marginTop: "1.5rem" }}>
            Go to Qevie
          </button>
        </div>
      </div>
    );
  }

  if (parsed === null) {
    return <div className="flex-center" style={{ minHeight: "100dvh" }}><span className="spinner spinner-lg" /></div>;
  }

  const amountUsd = parsed.amount !== undefined ? (Number(parsed.amount) / 1e6).toFixed(2) : null;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Gradient backdrop */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)",
          width: 500, height: 500, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1, flex: 1,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "2rem 1.5rem", maxWidth: 420, margin: "0 auto", width: "100%",
      }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟡ Qevie</div>
          <p className="text-muted">Payment request</p>
        </div>

        <div className="card-gradient fade-in" style={{ textAlign: "center" }}>
          {expired && (
            <div className="chip chip-error mb-4" style={{ display: "inline-flex" }}>
              This link has expired
            </div>
          )}

          {amountUsd !== null ? (
            <>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                Amount requested
              </div>
              <div className="amount-big">${amountUsd}</div>
              <div className="amount-currency">QUSDC</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>💸</div>
              <h2>Open amount</h2>
              <p className="text-muted mt-1">You choose how much to send</p>
            </>
          )}

          {parsed.memo && (
            <div className="mt-4" style={{
              padding: "0.625rem 1rem", background: "rgba(0,0,0,0.2)",
              borderRadius: "var(--radius)", fontSize: "0.875rem",
            }}>
              "{parsed.memo}"
            </div>
          )}

          <div className="divider" style={{ margin: "1.25rem 0" }} />

          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>To</div>
          <div className="mono truncate" style={{ fontSize: "0.8125rem" }}>{parsed.to}</div>

          {(parsed.maxUses !== undefined || parsed.expiry !== undefined) && (
            <div style={{ display: "flex", gap: "0.4rem", justifyContent: "center", marginTop: "0.875rem", flexWrap: "wrap" }}>
              {parsed.maxUses !== undefined && <span className="chip chip-muted">max {parsed.maxUses} uses</span>}
              {parsed.expiry !== undefined && (
                <span className="chip chip-muted">
                  expires {new Date(parsed.expiry * 1000).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          {address === null ? (
            <button className="btn-primary btn-lg" onClick={() => { void connect(); }} disabled={isConnecting || expired}>
              {isConnecting ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Connecting…</> : "Connect wallet to pay"}
            </button>
          ) : (
            <button className="btn-primary btn-lg" onClick={handlePay} disabled={expired}>
              {amountUsd !== null ? `Pay $${amountUsd}` : "Continue to pay"}
            </button>
          )}
          <p className="text-muted" style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.8125rem" }}>
            ⚡ Gasless · no QIE needed
          </p>
        </div>
      </div>
    </div>
  );
}
