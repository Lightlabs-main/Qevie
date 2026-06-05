import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

export default function Home(): React.ReactElement {
  const client = useQevieClient();
  const { address, signerAddress } = useWallet();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [freeOps, setFreeOps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (address === null) return;
    let mounted = true;

    const fetch = async (): Promise<void> => {
      try {
        const [bal, quote] = await Promise.all([
          client.publicClient.readContract({
            address: APP_CONFIG.contracts.qusdc,
            abi: QUSDC_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          client.quoteGas({ getAddress: async () => address, signMessage: async () => "0x" as `0x${string}` }, "sponsored"),
        ]);
        if (mounted) {
          setBalance(bal as bigint);
          setFreeOps(quote.freeOpsRemaining ?? 0);
        }
      } catch { /* silently fail */ }
      finally { if (mounted) setLoading(false); }
    };
    void fetch();
    return () => { mounted = false; };
  }, [address, client]);

  const usd = balance !== null ? (Number(balance) / 1e6).toFixed(2) : null;
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  const actions = [
    { to: "/send", icon: "↑", label: "Send",   color: "#7c3aed" },
    { to: "/links", icon: "🔗", label: "Links",  color: "#db2777" },
    { to: "/batch", icon: "⊛", label: "Batch",  color: "#0891b2" },
    { to: "/scan",  icon: "⊞", label: "Scan",   color: "#059669" },
  ];

  return (
    <main className="page fade-in">
      {/* Top bar */}
      <div className="flex-between" style={{ paddingTop: "0.5rem", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>
            {APP_CONFIG.chainId === 1990 ? "QIE Mainnet" : "QIE Testnet"}
          </div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-2)" }} className="mono">
            {shortAddr}
          </div>
        </div>
        <Link to="/profile" style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "var(--gradient)", display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: "1rem", color: "#fff", textDecoration: "none",
          boxShadow: "0 2px 12px var(--accent-glow)",
        }}>👤</Link>
      </div>

      {/* Balance card */}
      <div className="card-gradient mb-4" style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>
          QUSDC Balance
        </div>
        {loading ? (
          <div style={{ padding: "1rem 0" }}>
            <span className="spinner spinner-lg" style={{ borderTopColor: "var(--accent-light)" }} />
          </div>
        ) : (
          <>
            <div className="amount-big">${usd ?? "—"}</div>
            <div className="amount-currency">QUSDC · QIE Network</div>
            {freeOps !== null && freeOps > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <span className="chip chip-success">
                  ⚡ {freeOps} free transaction{freeOps !== 1 ? "s" : ""} left
                </span>
              </div>
            )}
          </>
        )}
        {address !== null && (
          <a
            href={`${EXPLORER}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.3rem",
              fontSize: "0.75rem", color: "var(--text-muted)",
              marginTop: "0.875rem", textDecoration: "none",
            }}
          >
            View on explorer →
          </a>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.625rem", marginBottom: "1.5rem" }}>
        {actions.map((a) => (
          <Link key={a.to} to={a.to} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: "0.5rem", textDecoration: "none",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", padding: "0.875rem 0.5rem",
            color: "var(--text-2)", transition: "border-color 0.15s, background 0.15s",
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: "12px",
              background: `${a.color}1a`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.25rem", color: a.color,
            }}>{a.icon}</div>
            <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Subscriptions teaser */}
      <div className="flex-between mb-3">
        <h2 style={{ fontSize: "1rem" }}>Recurring</h2>
        <Link to="/subscriptions" className="text-accent" style={{ fontSize: "0.8125rem", textDecoration: "none" }}>
          Manage →
        </Link>
      </div>
      <div className="card" style={{ textAlign: "center", padding: "1.75rem" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔄</div>
        <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>No active subscriptions</div>
        <p className="text-muted" style={{ fontSize: "0.8125rem" }}>
          Set up recurring payments to pay anyone automatically.
        </p>
        <Link to="/subscriptions" className="btn-ghost btn-sm" style={{
          display: "inline-flex", marginTop: "1rem",
          borderRadius: "var(--radius-sm)", padding: "0.5rem 1rem",
          background: "var(--accent-dim)", border: "1px solid rgba(124,58,237,0.3)",
          color: "var(--accent-light)", fontSize: "0.8125rem", fontWeight: 600,
          textDecoration: "none",
        }}>
          Set up →
        </Link>
      </div>
    </main>
  );
}
