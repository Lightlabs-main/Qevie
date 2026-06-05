import React, { useEffect, useState } from "react";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";

export default function Dashboard(): React.ReactElement {
  const { address, signerAddress, disconnect } = useWallet();
  const client = useQevieClient();
  const [walletQieBalance, setWalletQieBalance] = useState<bigint | null>(null);
  const [walletQusdcBalance, setWalletQusdcBalance] = useState<bigint | null>(null);
  const [smartQieBalance, setSmartQieBalance] = useState<bigint | null>(null);
  const [smartQusdcBalance, setSmartQusdcBalance] = useState<bigint | null>(null);

  const explorerBase = APP_CONFIG.chainId === 1990
    ? "https://mainnet.qie.digital"
    : "https://testnet.qie.digital";

  const short = (value: string | null): string =>
    value === null ? "Not connected" : `${value.slice(0, 8)}...${value.slice(-6)}`;
  const formatQie = (value: bigint | null): string =>
    value === null ? "Loading..." : `${(Number(value) / 1e18).toFixed(4)} QIE`;
  const formatQusdc = (value: bigint | null): string =>
    value === null ? "Loading..." : `${(Number(value) / 1e6).toFixed(2)} QUSDC`;

  useEffect(() => {
    let cancelled = false;

    const loadBalances = async (): Promise<void> => {
      try {
        const [ownerBal, ownerTokenBal, smartBal, tokenBal] = await Promise.all([
          signerAddress !== null ? client.publicClient.getBalance({ address: signerAddress }) : Promise.resolve(null),
          signerAddress !== null
            ? client.publicClient.readContract({
                address: APP_CONFIG.contracts.qusdc,
                abi: QUSDC_ABI,
                functionName: "balanceOf",
                args: [signerAddress],
              })
            : Promise.resolve(null),
          address !== null ? client.publicClient.getBalance({ address }) : Promise.resolve(null),
          address !== null
            ? client.publicClient.readContract({
                address: APP_CONFIG.contracts.qusdc,
                abi: QUSDC_ABI,
                functionName: "balanceOf",
                args: [address],
              })
            : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setWalletQieBalance(ownerBal);
        setWalletQusdcBalance(ownerTokenBal as bigint | null);
        setSmartQieBalance(smartBal);
        setSmartQusdcBalance(tokenBal as bigint | null);
      } catch {
        if (cancelled) return;
        setWalletQieBalance(null);
        setWalletQusdcBalance(null);
        setSmartQieBalance(null);
        setSmartQusdcBalance(null);
      }
    };

    void loadBalances();
    return () => { cancelled = true; };
  }, [address, signerAddress, client]);

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Wallet</h2>

      <div className="card-gradient" style={{ marginBottom: "1rem" }}>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>
          Account setup
        </p>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <p className="text-muted" style={{ fontSize: "0.75rem" }}>QIE Wallet signs</p>
            <p className="mono" style={{ fontWeight: 700 }}>{short(signerAddress)}</p>
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: "0.75rem" }}>Qevie Smart Account pays and receives</p>
            <p className="mono" style={{ fontWeight: 700 }}>{short(address)}</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>Qevie Smart Account</p>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Gasless app account</p>
        <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
          {formatQusdc(smartQusdcBalance)} · {formatQie(smartQieBalance)}
        </p>
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
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>QIE Wallet</p>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Owner and signer</p>
        <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
          {formatQusdc(walletQusdcBalance)} · {formatQie(walletQieBalance)}
        </p>
        <p style={{ fontFamily: "monospace", wordBreak: "break-all", fontSize: "0.875rem" }}>
          {signerAddress}
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-muted" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>Gas</p>
        <p style={{ fontWeight: 600 }}>Sponsored by Qevie Paymaster</p>
        <p className="text-muted" style={{ marginTop: "0.4rem" }}>
          Native QIE can be 0 while sponsored actions still work.
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
