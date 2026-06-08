import React, { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import { QUSDC_ABI } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";

const FAUCET_QUSDC = 100_000_000n; // 100 QUSDC (6 decimals)
const QIE_TOPUP = 500_000_000_000_000_000n; // 0.5 QIE for the smart account's own gas
const QIE_MIN = 50_000_000_000_000_000n; // top up only if smart account has < 0.05 QIE

const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface ChainConfig {
  chainId: number;
  chainName: string;
  rpcUrls: string[];
  blockExplorerUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

const TARGET_CHAIN: ChainConfig = APP_CONFIG.chainId === 1990
  ? {
    chainId: 1990,
    chainName: "QIE Mainnet",
    rpcUrls: [APP_CONFIG.rpcUrl],
    blockExplorerUrls: ["https://mainnet.qie.digital"],
    nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  }
  : {
    chainId: 1983,
    chainName: "QIE Testnet",
    rpcUrls: [APP_CONFIG.rpcUrl],
    blockExplorerUrls: ["https://testnet.qie.digital"],
    nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  };

function describeProviderError(error: unknown): string {
  const maybeCode = (error as { code?: number }).code;
  const message = error instanceof Error ? error.message : String(error);
  if (maybeCode === 4001) return "Network switch was rejected in the wallet.";
  if (maybeCode === 4902) return "QIE Testnet is not added in the wallet yet.";
  if (/unsupported|not support|not implemented/i.test(message)) {
    return "This wallet does not support automatic network switching.";
  }
  return message && message !== "[object Object]" ? message : "Automatic network switch failed.";
}

export default function Dashboard(): React.ReactElement {
  const client = useQevieClient();
  const { address, signer, signerAddress, disconnect } = useWallet();
  const gasStatus = useGasStatus(client, signer, address);

  const [walletQie, setWalletQie] = useState<bigint | null>(null);
  const [walletQusdc, setWalletQusdc] = useState<bigint | null>(null);
  const [smartQie, setSmartQie] = useState<bigint | null>(null);
  const [smartQusdc, setSmartQusdc] = useState<bigint | null>(null);
  const [minting, setMinting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  const isTestnet = APP_CONFIG.chainId === 1983;
  const explorerBase = APP_CONFIG.chainId === 1990
    ? "https://mainnet.qie.digital"
    : "https://testnet.qie.digital";

  const short = (value: string | null): string =>
    value === null ? "Not connected" : `${value.slice(0, 8)}...${value.slice(-6)}`;
  const formatQie = (value: bigint | null): string =>
    value === null ? "…" : `${(Number(value) / 1e18).toFixed(4)} QIE`;
  const formatQusdc = (value: bigint | null): string =>
    value === null ? "…" : `${(Number(value) / 1e6).toFixed(2)} QUSDC`;

  const copyAddr = (): void => {
    if (address === null) return;
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [ownerQie, ownerToken, accQie, accToken] = await Promise.all([
        signerAddress !== null ? client.publicClient.getBalance({ address: signerAddress }) : Promise.resolve(null),
        signerAddress !== null
          ? client.publicClient.readContract({
            address: APP_CONFIG.contracts.qusdc, abi: QUSDC_ABI, functionName: "balanceOf", args: [signerAddress],
          })
          : Promise.resolve(null),
        address !== null ? client.publicClient.getBalance({ address }) : Promise.resolve(null),
        address !== null
          ? client.publicClient.readContract({
            address: APP_CONFIG.contracts.qusdc, abi: QUSDC_ABI, functionName: "balanceOf", args: [address],
          })
          : Promise.resolve(null),
      ]);
      setWalletQie(ownerQie as bigint | null);
      setWalletQusdc(ownerToken as bigint | null);
      setSmartQie(accQie as bigint | null);
      setSmartQusdc(accToken as bigint | null);
    } catch { /* leave previous values */ }
  }, [address, signerAddress, client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const detectWalletChain = useCallback(async (): Promise<void> => {
    const eth = (window as typeof window & { ethereum?: Eip1193 }).ethereum;
    if (eth === undefined) return;
    try {
      const chainHex = await eth.request({ method: "eth_chainId" }) as string;
      setWalletChainId(parseInt(chainHex, 16));
    } catch {
      setWalletChainId(null);
    }
  }, []);

  useEffect(() => {
    void detectWalletChain();
  }, [detectWalletChain]);

  const handleSwitchNetwork = async (): Promise<void> => {
    const eth = (window as typeof window & { ethereum?: Eip1193 }).ethereum;
    if (eth === undefined) {
      setError("No wallet provider found");
      return;
    }

    setSwitchingNetwork(true);
    setError(null);
    setMsg(null);
    try {
      const chainHex = `0x${TARGET_CHAIN.chainId.toString(16)}`;
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainHex,
            chainName: TARGET_CHAIN.chainName,
            rpcUrls: TARGET_CHAIN.rpcUrls,
            blockExplorerUrls: TARGET_CHAIN.blockExplorerUrls,
            nativeCurrency: TARGET_CHAIN.nativeCurrency,
          }],
        });
      } catch (addError) {
        const code = (addError as { code?: number }).code;
        const message = addError instanceof Error ? addError.message : String(addError);
        if (code !== 4902 && !/already exists|already added|known chain|chain.*exists/i.test(message)) {
          throw addError;
        }
      }

      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
      setWalletChainId(TARGET_CHAIN.chainId);
      setMsg(`Wallet switched to ${TARGET_CHAIN.chainName}.`);
    } catch (e) {
      setError(describeProviderError(e));
    } finally {
      setSwitchingNetwork(false);
    }
  };

  const wrongWalletNetwork = walletChainId !== null && walletChainId !== APP_CONFIG.chainId;

  const handleFaucet = async (): Promise<void> => {
    if (address === null || signerAddress === null) { setError("Wallet not connected"); return; }
    const eth = (window as typeof window & { ethereum?: Eip1193 }).ethereum;
    if (eth === undefined) { setError("No wallet provider found"); return; }

    setMinting(true); setError(null); setMsg(null);
    try {
      // The faucet runs as normal transactions from your connected EOA (gas paid
      // from your QIE), since the smart account can't self-fund its first QIE.
      const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
      const currentChainId = parseInt(chainHex, 16);
      setWalletChainId(currentChainId);
      if (currentChainId !== APP_CONFIG.chainId) {
        setError(`Wallet is on chain ${currentChainId}. Switch to ${TARGET_CHAIN.chainName} (${TARGET_CHAIN.chainId}) to use the faucet.`);
        return;
      }

      // Mint mock QUSDC to the smart account...
      setMsg("Confirm the mint in your wallet…");
      const mintTx = (await eth.request({
        method: "eth_sendTransaction",
        params: [{
          from: signerAddress,
          to: APP_CONFIG.contracts.qusdc,
          data: encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [address, FAUCET_QUSDC] }),
        }],
      })) as Hex;
      await client.publicClient.waitForTransactionReceipt({ hash: mintTx });

      // ...and top up the smart account's QIE if it's low, so it can pay its own
      // gas once the 3 free sponsored ops are used up.
      if (smartQie === null || smartQie < QIE_MIN) {
        setMsg("Confirm the QIE top-up in your wallet…");
        const qieTx = (await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: signerAddress, to: address, value: `0x${QIE_TOPUP.toString(16)}` }],
        })) as Hex;
        await client.publicClient.waitForTransactionReceipt({ hash: qieTx });
      }

      setMsg("Funded your smart account with 100 test QUSDC ✓");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Faucet failed");
    } finally {
      setMinting(false);
    }
  };

  return (
    <main className="page fade-in">
      <h2 style={{ marginBottom: "1.25rem" }}>Wallet</h2>

      {/* Smart account — spendable balance */}
      <div className="card-gradient" style={{ marginBottom: "1rem" }}>
        <div className="flex-between" style={{ marginBottom: "0.6rem" }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Smart Account
          </span>
          <span className="chip chip-accent">Gasless</span>
        </div>
        <p style={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.1 }}>{formatQusdc(smartQusdc)}</p>
        <p className="text-muted" style={{ marginBottom: "0.85rem", fontSize: "0.85rem" }}>{formatQie(smartQie)}</p>
        <div className="flex-between" style={{ gap: "var(--s-3)", marginTop: "var(--s-2)" }}>
          <span className="mono" style={{ fontSize: "0.8125rem", color: "var(--text-2)", opacity: 0.8 }}>{short(address)}</span>
          <div className="flex-center" style={{ gap: "var(--s-1)", flexShrink: 0 }}>
            <button className="btn-secondary btn-sm" onClick={copyAddr} style={{ minWidth: "80px" }}>
              {copied ? "✓ COPIED" : "COPY"}
            </button>
            {address !== null && (
              <a
                className="btn-secondary btn-sm"
                href={`${explorerBase}/address/${address}`}
                target="_blank" rel="noreferrer"
                style={{ textDecoration: "none" }}
              >
                EXPLORER ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <GasStatusPanel status={gasStatus} />
      </div>

      {/* Signer (owner EOA) */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="flex-between">
          <div>
            <p className="text-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Signer · QIE Wallet</p>
            <p className="mono" style={{ fontWeight: 600 }}>{short(signerAddress)}</p>
          </div>
          <p className="text-muted" style={{ fontSize: "0.78rem", textAlign: "right", lineHeight: 1.5 }}>
            {formatQusdc(walletQusdc)}<br />{formatQie(walletQie)}
          </p>
        </div>
      </div>

      {/* Testnet faucet */}
      {isTestnet && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="flex-between" style={{ marginBottom: "0.75rem" }}>
            <p className="text-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Testnet faucet</p>
            <span className="text-muted" style={{ fontSize: "0.75rem" }}>100 QUSDC + gas</span>
          </div>
          {wrongWalletNetwork && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.8rem 0.9rem",
                borderRadius: "14px",
                border: "1px solid rgba(244, 63, 94, 0.35)",
                background: "rgba(244, 63, 94, 0.08)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text)" }}>
                Wallet network mismatch. Faucet needs {TARGET_CHAIN.chainName}.
              </p>
              <p className="text-muted" style={{ margin: "0.35rem 0 0" }}>
                Current chain: {walletChainId}
              </p>
              <div className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.72rem", lineHeight: 1.55 }}>
                Target chain ID: {TARGET_CHAIN.chainId}<br />
                RPC: {TARGET_CHAIN.rpcUrls[0]}
              </div>
            </div>
          )}
          <button
            className="btn-primary"
            onClick={() => { void handleFaucet(); }}
            disabled={minting || wrongWalletNetwork}
            style={{ width: "100%" }}
          >
            {minting
              ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Minting…</>
              : "Get test funds"}
          </button>
          {wrongWalletNetwork && (
            <button
              className="btn-secondary"
              onClick={() => { void handleSwitchNetwork(); }}
              disabled={switchingNetwork}
              style={{ width: "100%", marginTop: "0.75rem" }}
            >
              {switchingNetwork
                ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Switching…</>
                : `Switch to ${TARGET_CHAIN.chainName}`}
            </button>
          )}
          {msg !== null && <p style={{ color: "var(--success, #16a34a)", fontSize: "0.8rem", marginTop: "0.75rem" }}>{msg}</p>}
          {error !== null && <p style={{ color: "var(--error)", fontSize: "0.8rem", marginTop: "0.75rem" }}>{error}</p>}
        </div>
      )}

      {/* Network */}
      <div className="card" style={{ marginBottom: "1.5rem", display: "grid", gap: "0.6rem" }}>
        <div className="flex-between">
          <span className="text-muted" style={{ fontSize: "0.8rem" }}>Network</span>
          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{APP_CONFIG.chainId === 1990 ? "QIE Mainnet" : "QIE Testnet"}</span>
        </div>
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
