import React from "react";
import { useWallet } from "../hooks/useWallet.js";

export default function Onboarding(): React.ReactElement {
  const { connect, isConnecting, error } = useWallet();

  // Routing is handled by App.tsx watching address state.
  // No navigate() needed here — when connect() succeeds, address
  // becomes non-null and App.tsx automatically shows the home screen.

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
        gap: "2rem",
      }}
    >
      <div>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⟡</div>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "var(--accent-light)" }}>Qevie</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Gasless stablecoin payments on QIE
        </p>
      </div>

      <div className="card" style={{ width: "100%", maxWidth: "360px" }}>
        <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Get started</h2>
        <ul
          style={{
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            marginBottom: "1.5rem",
            textAlign: "left",
          }}
        >
          {[
            "Zero gas fees — powered by ERC-4337",
            "Send QUSDC to anyone, anywhere",
            "Recurring & batch payments",
            "QR code payments",
          ].map((feat) => (
            <li key={feat} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <span style={{ color: "var(--success)" }}>✓</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{feat}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => { void connect(); }}
          disabled={isConnecting}
          style={{ width: "100%" }}
        >
          {isConnecting ? <span className="spinner" /> : "Connect Wallet"}
        </button>

        {error !== null && (
          <p className="text-error" style={{ marginTop: "1rem", fontSize: "0.875rem" }}>
            {error}
          </p>
        )}
      </div>

      <p className="text-muted" style={{ maxWidth: "300px", fontSize: "0.8rem" }}>
        Supports QIE Wallet, MetaMask, and any EIP-1193 compatible wallet
      </p>
    </div>
  );
}
