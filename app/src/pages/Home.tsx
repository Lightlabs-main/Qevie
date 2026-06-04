import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";

export default function Home(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();

  const [qusdcBalance, setQusdcBalance] = useState<bigint | null>(null);
  const [freeOps, setFreeOps] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);

  useEffect(() => {
    if (address === null) return;

    const fetchBalances = async (): Promise<void> => {
      try {
        const [balance, quote] = await Promise.all([
          client.publicClient.readContract({
            address: APP_CONFIG.contracts.qusdc,
            abi: QUSDC_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          client.quoteGas({ getAddress: async () => address, signMessage: async () => "0x" }, "sponsored"),
        ]);
        setQusdcBalance(balance as bigint);
        setFreeOps(quote.freeOpsRemaining ?? 0);
      } catch {
        // Network error — show placeholder.
      } finally {
        setLoadingBalance(false);
      }
    };

    void fetchBalances();
  }, [address, client]);

  const formattedBalance =
    qusdcBalance !== null
      ? `$${(Number(qusdcBalance) / 1e6).toFixed(2)}`
      : "—";

  return (
    <main className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>⟡ Qevie</h1>
        <Link to="/profile" style={{ fontSize: "1.5rem", color: "var(--text-muted)" }}>◉</Link>
      </div>

      {/* Balance card */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, #7c3aed22, #4c1d9522)",
          border: "1px solid var(--accent)",
          marginBottom: "1.5rem",
          textAlign: "center",
        }}
      >
        <p className="text-muted" style={{ marginBottom: "0.25rem" }}>QUSDC Balance</p>
        <p style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--accent-light)" }}>
          {loadingBalance ? <span className="spinner" /> : formattedBalance}
        </p>
        {freeOps !== null && freeOps > 0 && (
          <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            🎁 {freeOps} free transaction{freeOps !== 1 ? "s" : ""} remaining
          </p>
        )}
        <p
          className="text-muted"
          style={{ marginTop: "0.5rem", fontSize: "0.75rem", fontFamily: "monospace", wordBreak: "break-all" }}
        >
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </p>
      </div>

      {/* Quick actions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        {[
          { to: "/send", icon: "↗", label: "Send" },
          { to: "/request", icon: "↙", label: "Request" },
          { to: "/scan", icon: "⊞", label: "Scan QR" },
          { to: "/batch", icon: "⊛", label: "Batch" },
        ].map((action) => (
          <Link
            key={action.to}
            to={action.to}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "1rem",
              color: "var(--text)",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 600,
              transition: "border-color 0.15s",
            }}
          >
            <span style={{ fontSize: "1.5rem" }}>{action.icon}</span>
            {action.label}
          </Link>
        ))}
      </div>

      {/* Subscriptions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>Recurring</h2>
        <Link to="/subscriptions" className="text-muted" style={{ fontSize: "0.8rem" }}>
          View all →
        </Link>
      </div>
      <div className="card text-muted" style={{ textAlign: "center", padding: "1.5rem" }}>
        <p>No active subscriptions.</p>
        <Link to="/subscriptions" style={{ fontSize: "0.875rem", marginTop: "0.5rem", display: "inline-block" }}>
          Set one up →
        </Link>
      </div>
    </main>
  );
}
