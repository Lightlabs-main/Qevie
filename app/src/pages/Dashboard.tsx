import React from "react";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";

export default function Dashboard(): React.ReactElement {
  const { address, signerAddress, disconnect } = useWallet();

  const explorerBase = APP_CONFIG.chainId === 1990
    ? "https://mainnet.qie.digital"
    : "https://testnet.qie.digital";

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Wallet</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>Smart Account</p>
        <p style={{ fontFamily: "monospace", wordBreak: "break-all", fontSize: "0.875rem" }}>
          {address}
        </p>
        {address !== null && (
          <a
            href={`${explorerBase}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "0.8rem", marginTop: "0.5rem", display: "inline-block" }}
          >
            View on QIE Explorer →
          </a>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>Connected Signer (EOA)</p>
        <p style={{ fontFamily: "monospace", wordBreak: "break-all", fontSize: "0.875rem" }}>
          {signerAddress}
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>Network</p>
        <p style={{ fontWeight: 600 }}>
          {APP_CONFIG.chainId === 1990 ? "QIE Mainnet (1990)" : "QIE Testnet (1983)"}
        </p>
      </div>

      <button
        onClick={disconnect}
        style={{ width: "100%", background: "var(--surface)", color: "var(--error)", border: "1px solid var(--error)" }}
      >
        Disconnect
      </button>
    </main>
  );
}
