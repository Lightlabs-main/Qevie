import React, { useEffect, useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { USERNAME_REGISTRY_ABI, buildPaymentUri } from "@qevie/sdk";
import { QRCodeSVG } from "qrcode.react";
import BackButton from "../components/BackButton.js";

export default function Profile(): React.ReactElement {
  const client = useQevieClient();
  const { address, signer } = useWallet();

  const [username, setUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [registeredUsername, setRegisteredUsername] = useState<string | null>(null);

  const receiveTarget = registeredUsername ?? address;
  const receiveUri = receiveTarget ? buildPaymentUri({ to: receiveTarget }) : null;
  const copyValue = registeredUsername ?? receiveUri;

  useEffect(() => {
    if (address === null) return;

    let cancelled = false;
    client.publicClient.readContract({
      address: client.config.contracts.usernameRegistry,
      abi: USERNAME_REGISTRY_ABI,
      functionName: "reverseResolve",
      args: [address],
    }).then((stored) => {
      if (cancelled || typeof stored !== "string" || stored.length === 0) return;
      setUsername(stored);
      setRegisteredUsername(stored);
      setRegistered(true);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [address, client]);

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
      setRegisteredUsername(clean);
      setRegistered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <BackButton />
        <h2 className="page-title">Profile</h2>
      </div>

      {/* QR for receiving */}
      {receiveUri !== null && (
        <div className="card" style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <p style={{ fontWeight: 600 }}>
            {registeredUsername !== null ? "Receive as username" : "Receive at smart account"}
          </p>
          <p className="text-muted" style={{ fontSize: "0.8125rem", textAlign: "center", maxWidth: 260 }}>
            {registeredUsername !== null ? registeredUsername : address}
          </p>
          <QRCodeSVG value={receiveUri} size={180} bgColor="transparent" fgColor="var(--text)" />
          <button
            onClick={() => { if (copyValue !== null) void navigator.clipboard.writeText(copyValue); }}
            style={{ background: "transparent", color: "var(--accent-light)", border: "1px solid var(--border)", padding: "0.4rem 1rem", fontSize: "0.875rem" }}
          >
            {registeredUsername !== null ? "Copy username" : "Copy URI"}
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
          <p className="text-success">You are registered as <strong>{registeredUsername ?? username}</strong>.</p>
        )}
      </div>
    </main>
  );
}
