import React, { useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { buildPaymentUri } from "@qevie/sdk";
import { QRCodeSVG } from "qrcode.react";

export default function Profile(): React.ReactElement {
  const client = useQevieClient();
  const { address, signer } = useWallet();

  const [username, setUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  const receiveUri = address ? buildPaymentUri({ to: address }) : null;

  async function handleRegister(): Promise<void> {
    if (signer === null) { setError("Wallet not connected"); return; }
    const clean = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{2,32}$/.test(clean)) {
      setError("Username must be 2–32 chars, lowercase letters, numbers, and underscores only");
      return;
    }

    setIsRegistering(true);
    setError(null);

    try {
      await client.registerUsername(signer, clean);
      setRegistered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Profile</h2>

      {/* QR for receiving */}
      {receiveUri !== null && (
        <div className="card" style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <p style={{ fontWeight: 600 }}>Your receive QR</p>
          <QRCodeSVG value={receiveUri} size={180} bgColor="transparent" fgColor="var(--text)" />
          <button
            onClick={() => { void navigator.clipboard.writeText(receiveUri); }}
            style={{ background: "transparent", color: "var(--accent-light)", border: "1px solid var(--border)", padding: "0.4rem 1rem", fontSize: "0.875rem" }}
          >
            Copy URI
          </button>
        </div>
      )}

      {/* Username registration */}
      <div className="card">
        <p style={{ fontWeight: 600, marginBottom: "1rem" }}>
          {registered ? "Username registered ✓" : "Register a username"}
        </p>
        {!registered ? (
          <>
            <p className="text-muted" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
              Register a short name so others can pay you by name instead of address.
            </p>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_name"
              maxLength={32}
              style={{ marginBottom: "0.75rem" }}
            />
            {error !== null && <p className="text-error" style={{ marginBottom: "0.75rem", fontSize: "0.875rem" }}>{error}</p>}
            <button
              onClick={() => { void handleRegister(); }}
              disabled={!username.trim() || isRegistering}
              style={{ width: "100%" }}
            >
              {isRegistering ? <span className="spinner" /> : "Register username"}
            </button>
          </>
        ) : (
          <p className="text-success">You are registered as <strong>{username}</strong>.</p>
        )}
      </div>
    </main>
  );
}
