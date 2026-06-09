import React from "react";
import { useWallet } from "../hooks/useWallet.js";
import Logo from "../components/Logo.js";

const FEATURES = [
  {
    icon: "◎",
    label: "Autopilot agents",
    desc: "Scoped agents execute QUSDC workflows inside on-chain policy limits.",
  },
  {
    icon: "$",
    label: "Gas in USDC",
    desc: "No native token needed — the paymaster fronts gas, you pay in QUSDC.",
  },
  {
    icon: "✦",
    label: "Readable .qie names",
    desc: "Pay alice.qie. Domains resolve on-chain; policies lock the address.",
  },
];

export default function Onboarding(): React.ReactElement {
  const { connect, isConnecting, error, needsWalletApp, walletDeepLink } = useWallet();

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", display: "flex" }}>
      <div
        className="app-container"
        style={{
          flex: 1,
          justifyContent: "space-between",
          paddingTop: "max(var(--s-8), env(safe-area-inset-top))",
          paddingBottom: "max(var(--s-6), env(safe-area-inset-bottom))",
          gap: "var(--s-6)",
        }}
      >
        {/* Brand + hero */}
        <div className="tight-stack" style={{ gap: "var(--s-5)" }}>
          <div className="flex-center" style={{ flexDirection: "column", gap: "var(--s-3)" }}>
            <Logo size={84} glow={false} />
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 900,
                fontSize: "1.5rem",
                letterSpacing: "0.18em",
                background: "linear-gradient(135deg, #fff 40%, var(--accent) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              QEVIE
            </span>
          </div>

          <div className="tight-stack" style={{ textAlign: "center", gap: "var(--s-2)" }}>
            <span className="chip chip-accent" style={{ alignSelf: "center" }}>
              Agent-native PayFi on QIE
            </span>
            <h1 className="text-gradient" style={{ lineHeight: 1.05 }}>
              Policies in.<br />Autonomous QUSDC out.
            </h1>
            <p className="text-muted" style={{ margin: "0 auto", maxWidth: "300px" }}>
              Tell Qevie what should happen. Autopilot picks the rail; your
              smart-account policy enforces the boundary.
            </p>
          </div>
        </div>

        {/* Feature rail */}
        <div className="tight-stack">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="surface-card"
              style={{ display: "flex", gap: "var(--s-3)", alignItems: "center" }}
            >
              <div
                style={{
                  flex: "0 0 auto",
                  width: 40,
                  height: 40,
                  borderRadius: "12px",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--accent-soft)",
                  color: "var(--accent-light)",
                  border: "1px solid var(--accent-soft)",
                  fontWeight: 800,
                  fontSize: "1.1rem",
                }}
              >
                {f.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: "var(--text-pure)" }}>{f.label}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="tight-stack" style={{ gap: "var(--s-2)" }}>
          <button
            className="btn-primary btn-lg"
            onClick={() => { void connect(); }}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <span className="flex-center" style={{ gap: "var(--s-2)" }}>
                <span className="spinner" /> Connecting…
              </span>
            ) : (
              "Launch Qevie"
            )}
          </button>

          {error && <div className="alert alert-error">{error}</div>}

          {needsWalletApp && (
            <div className="tight-stack" style={{ gap: "var(--s-2)" }}>
              <a
                className="btn-secondary btn-lg"
                href={walletDeepLink}
                style={{ textDecoration: "none" }}
              >
                Open in MetaMask
              </a>
              <p className="text-muted" style={{ fontSize: "0.75rem", textAlign: "center" }}>
                Or open this page inside the QIE Wallet app&apos;s browser.
              </p>
            </div>
          )}

          <div
            className="flex-center"
            style={{ marginTop: "var(--s-2)", opacity: 0.4, gap: "0.5rem" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
            <span style={{ fontSize: "0.625rem", fontWeight: 800, letterSpacing: "0.18em" }}>
              QIE MAINNET · NON-CUSTODIAL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
