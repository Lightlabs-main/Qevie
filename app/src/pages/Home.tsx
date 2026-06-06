import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import Logo from "../components/Logo.js";

export default function Home(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (address === null) return;
    let mounted = true;

    const fetch = async (): Promise<void> => {
      try {
        const bal = await client.publicClient.readContract({
          address: APP_CONFIG.contracts.qusdc,
          abi: QUSDC_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        if (mounted) setBalance(bal as bigint);
      } catch { /* fail silent */ }
      finally { if (mounted) setLoading(false); }
    };
    void fetch();
    return () => { mounted = false; };
  }, [address, client]);

  const usd = balance !== null ? (Number(balance) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

  const actions = [
    { to: "/send", label: "Send", icon: "↑", color: "var(--accent)" },
    { to: "/dashboard", label: "Wallet", icon: "👛", color: "#f59e0b" },
    { to: "/links", label: "Links", icon: "🔗", color: "#38bdf8" },
    { to: "/subscriptions", label: "Stats", icon: "🔄", color: "#818cf8" },
  ];

  return (
    <>
      {/* Header Branding */}
      <header className="page-header-tight flex-between">
        <div className="flex-center" style={{ gap: 12 }}>
          <Logo size={44} glow={false} />
          <span style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 900,
            fontSize: "1.375rem",
            letterSpacing: "0.08em",
            background: "linear-gradient(135deg, #fff 40%, var(--accent) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            lineHeight: 1,
          }}>QEVIE</span>
        </div>
        <div style={{
          fontSize: "0.6rem", color: "var(--text-muted)", fontWeight: 700,
          background: "var(--surface-2)", padding: "4px 10px", borderRadius: "var(--r-sm)",
          border: "1px solid var(--glass-border)", letterSpacing: "0.05em",
          alignSelf: "flex-end", marginBottom: 2,
        }}>MAINNET</div>
      </header>

      {/* Anchor Balance Section */}
      <section className="tight-stack" style={{ textAlign: "center", padding: "var(--s-6) 0" }}>
        <div className="section-label">Available Balance</div>
        <div style={{ position: "relative" }}>
          <h1 className="text-gradient" style={{ fontSize: "3.5rem" }}>
            <span style={{ fontSize: "0.5em", opacity: 0.3, marginRight: "4px" }}>$</span>
            {usd}
          </h1>
          {loading && <div className="flex-center" style={{ position: "absolute", inset: 0 }}><span className="spinner" /></div>}
        </div>
        <div className="flex-center" style={{ gap: "var(--s-1)", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {address?.slice(0, 10)}...{address?.slice(-4)}
        </div>
      </section>

      {/* Tight Action Tiles */}
      <section className="tight-stack">
        <div className="section-label">Services</div>
        <div className="tight-grid">
          {actions.map((act) => (
            <Link key={act.label} to={act.to} style={{ textDecoration: "none" }}>
              <div className="surface-card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "10px",
                  background: act.color + "15", color: act.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.125rem", border: `1px solid ${act.color}30`
                }}>{act.icon}</div>
                <div style={{ fontWeight: 700, fontSize: "0.9375rem" }}>{act.label}</div>
                <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>Managed {act.label.toLowerCase()}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Tight Status Strip */}
      <section style={{ marginTop: "var(--s-4)" }}>
        <div className="surface-card" style={{ padding: "var(--s-2) var(--s-3)" }}>
          <div className="flex-between">
            <div className="flex-center" style={{ gap: "var(--s-2)" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Network Secure</span>
            </div>
            <span style={{ fontSize: "0.625rem", fontWeight: 800, opacity: 0.3 }}>SEC-8021</span>
          </div>
        </div>
      </section>
    </>
  );
}
