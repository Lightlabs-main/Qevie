import React from "react";
import { useWallet } from "../hooks/useWallet.js";

export default function Onboarding(): React.ReactElement {
  const { connect, isConnecting, error } = useWallet();

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
      overflowX: "hidden",
    }}>
      {/* Hero gradient orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{
          position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)",
          width: "600px", height: "600px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)",
        }} />
        <div style={{
          position: "absolute", top: "40%", right: "-20%",
          width: "400px", height: "400px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(219,39,119,0.12) 0%, transparent 70%)",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "2rem 1.5rem",
        maxWidth: "420px", margin: "0 auto", width: "100%",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <div style={{
            width: "72px", height: "72px", margin: "0 auto 1.25rem",
            borderRadius: "22px",
            background: "var(--gradient)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "2rem",
            boxShadow: "0 8px 32px var(--accent-glow)",
          }}>⟡</div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "0.5rem" }}>
            Qevie
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>
            Gasless payments on QIE blockchain
          </p>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", width: "100%", marginBottom: "2.5rem" }}>
          {[
            { icon: "⚡", label: "Zero gas fees", sub: "Powered by ERC-4337 account abstraction" },
            { icon: "🔗", label: "Payment links", sub: "Single or split links with expiry & usage limits" },
            { icon: "🔄", label: "Recurring payments", sub: "Auto-charge subscriptions on schedule" },
            { icon: "📦", label: "Batch payouts", sub: "Pay many recipients in one transaction" },
          ].map((f) => (
            <div key={f.label} style={{
              display: "flex", alignItems: "center", gap: "1rem",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "0.875rem 1rem",
            }}>
              <div style={{
                width: "38px", height: "38px", flexShrink: 0,
                background: "var(--accent-dim)", borderRadius: "10px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem",
              }}>{f.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.1rem" }}>{f.label}</div>
                <div className="text-muted">{f.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Connect button */}
        <div style={{ width: "100%" }}>
          <button
            className="btn-primary btn-lg"
            onClick={() => { void connect(); }}
            disabled={isConnecting}
            style={{ marginBottom: "0.75rem" }}
          >
            {isConnecting
              ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Connecting…</>
              : <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  Connect Wallet
                </>
            }
          </button>

          {error !== null && (
            <div className="alert alert-error fade-in">
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <p className="text-muted" style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.8125rem" }}>
            Supports QIE Wallet, MetaMask, and any EIP-1193 wallet
          </p>
        </div>
      </div>
    </div>
  );
}
