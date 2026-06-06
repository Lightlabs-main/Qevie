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
    { to: "/send", icon: "↑", label: "Send", color: "var(--accent)" },
    { to: "/links", icon: "🔗", label: "Links", color: "#38bdf8" },
    { to: "/batch", icon: "⊛", label: "Batch", color: "#2dd4bf" },
    { to: "/scan", icon: "⊞", label: "Scan", color: "#10b981" },
  ];

  return (
    <main className="page fade-in">
      {/* Top bar */}
      <div className="flex-between" style={{ paddingTop: "0.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "10px",
            background: "var(--surface-2)", border: "1px solid var(--border-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "var(--shadow)"
          }}>
            <span style={{ fontSize: "1.25rem" }}>⚡</span>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {APP_CONFIG.chainId === 1990 ? "QIE Mainnet" : "QIE Testnet"}
            </div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text)" }} className="mono">
              {shortAddr}
            </div>
          </div>
        </div>
        <Link to="/profile" style={{
          width: 42, height: 42, borderRadius: "14px",
          background: "var(--surface-2)", border: "1px solid var(--border-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.25rem", color: "#fff", textDecoration: "none",
          boxShadow: "var(--shadow)", transition: "transform 0.2s"
        }} onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}>👤</Link>
      </div>

      {/* Balance card */}
      <div className="card-gradient mb-6" style={{
        textAlign: "center", padding: "2rem 1.5rem",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4), inset 0 0 80px rgba(6,182,212,0.05)"
      }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent-light)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "1rem", opacity: 0.8 }}>
          Available Balance
        </div>
        {loading ? (
          <div style={{ padding: "1.5rem 0" }}>
            <span className="spinner spinner-lg" />
          </div>
        ) : (
          <>
            <div className="amount-big" style={{ marginBottom: "0.25rem" }}>${usd ?? "—"}</div>
            <div className="amount-currency" style={{ color: "var(--text-2)", fontWeight: 500 }}>QUSDC · QIE Network</div>
            {freeOps !== null && freeOps > 0 && (
              <div style={{ marginTop: "1.25rem" }}>
                <span className="chip chip-success" style={{ padding: "0.4rem 0.8rem", borderRadius: "10px" }}>
                  <span style={{ fontSize: "1rem", marginRight: "0.25rem" }}>⚡</span> {freeOps} free operations
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
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              fontSize: "0.75rem", color: "var(--text-muted)",
              marginTop: "1.5rem", textDecoration: "none", fontWeight: 600,
              padding: "0.5rem 1rem", background: "var(--bg)", borderRadius: "8px",
              border: "1px solid var(--border)"
            }}
          >
            Explorer <span style={{ opacity: 0.5 }}>↗</span>
          </a>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        {actions.map((a) => (
          <Link key={a.to} to={a.to} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: "0.6rem", textDecoration: "none",
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", padding: "1rem 0.5rem",
            color: "var(--text-2)", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }} className="action-card">
            <div style={{
              width: 44, height: 44, borderRadius: "12px",
              background: `${a.color}15`,
              border: `1px solid ${a.color}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.25rem", color: a.color,
              boxShadow: `0 8px 16px ${a.color}10`
            }}>{a.icon}</div>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-2)" }}>{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Subscriptions teaser */}
      <div className="flex-between mb-4">
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700 }}>Recurring Payments</h2>
        <Link to="/subscriptions" className="text-accent" style={{ fontSize: "0.875rem", textDecoration: "none", fontWeight: 600 }}>
          View All
        </Link>
      </div>
      <div className="card-elevated" style={{ textAlign: "center", padding: "2rem", background: "var(--surface)" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "16px",
          background: "var(--accent-dim)", color: "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.75rem", margin: "0 auto 1.25rem",
          border: "1px solid var(--border-2)"
        }}>🔄</div>
        <div style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.5rem" }}>No active streams</div>
        <p className="text-muted" style={{ fontSize: "0.875rem", maxWidth: "240px", margin: "0 auto 1.5rem", lineHeight: 1.6 }}>
          Automate your bills and payroll with recurring stablecoin streams.
        </p>
        <Link to="/subscriptions" className="btn-primary" style={{
          padding: "0.75rem 1.5rem", fontSize: "0.875rem", fontWeight: 700,
          borderRadius: "12px", textDecoration: "none"
        }}>
          New Stream
        </Link>
      </div>
    </main>
  );
}
