import React from "react";
import { useWallet } from "../hooks/useWallet.js";
import Logo from "../components/Logo.js";

export default function Onboarding(): React.ReactElement {
  const { connect, isConnecting, error, needsWalletApp, walletDeepLink } = useWallet();

  return (
    <div className="flex-center" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <div className="app-container" style={{ paddingBottom: "var(--s-8)" }}>
        {/* Header Branding - Strictly Centered */}
        <div className="flex-center" style={{ marginBottom: "var(--s-6)" }}>
          <Logo size={100} glow={false} />
        </div>

        {/* Hero Section - Tight Alignment */}
        <div className="tight-stack" style={{ textAlign: "center", marginBottom: "var(--s-6)" }}>
          <h1 className="text-gradient">Finance, Redefined.</h1>
          <p className="text-muted" style={{ margin: "0 auto", maxWidth: "320px" }}>
            Experience seamless stablecoin payments on the high-speed QIE blockchain.
          </p>
        </div>

        {/* Feature Rail - Structured Grid */}
        <div className="tight-stack" style={{ marginBottom: "var(--s-10)" }}>
          {[
            { tag: "01", label: "Zero Gas Fees", desc: "No native tokens required for network fees." },
            { tag: "02", label: "Smart Payments", desc: "One-click settlement via shared web links." },
            { tag: "03", label: "MPC Security", desc: "Enterprise-grade protection on every wallet." },
          ].map((f) => (
            <div key={f.tag} className="surface-card-2" style={{ display: "flex", gap: "var(--s-3)", alignItems: "center" }}>
              <div style={{ color: "var(--accent)", fontWeight: 900, fontSize: "0.75rem" }}>{f.tag}</div>
              <div className="tight-stack" style={{ gap: "var(--s-1)" }}>
                <div style={{ fontWeight: 700, color: "var(--text-pure)" }}>{f.label}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Area - Focused Alignment */}
        <div className="tight-stack">
          <button className="btn-primary btn-lg" onClick={() => { void connect(); }} disabled={isConnecting}>
            {isConnecting
              ? <div className="flex-center" style={{ gap: "var(--s-2)" }}><span className="spinner" /> CONNECTING...</div>
              : "LAUNCH APP"
            }
          </button>

          {error && <div className="alert alert-error" style={{ marginTop: "var(--s-2)" }}>{error}</div>}

          {needsWalletApp && (
            <div className="tight-stack" style={{ marginTop: "var(--s-2)" }}>
              <a className="btn-secondary btn-lg" href={walletDeepLink} style={{ textAlign: "center", textDecoration: "none" }}>
                Open in MetaMask
              </a>
              <p className="text-muted" style={{ fontSize: "0.75rem", textAlign: "center" }}>
                Or open this page from inside the QIE Wallet app&apos;s browser.
              </p>
            </div>
          )}

          <div className="flex-center" style={{ marginTop: "var(--s-4)", opacity: 0.4 }}>
            <span style={{ fontSize: "0.625rem", fontWeight: 800, letterSpacing: "0.2em" }}>POWERED BY QIE FOUNDATION // 2026</span>
          </div>
        </div>
      </div>
    </div>
  );
}
