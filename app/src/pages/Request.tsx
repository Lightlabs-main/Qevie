import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { buildPaymentUri } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";
import { QRCodeSVG } from "qrcode.react";
import { decodeEventLog } from "viem";
import { PAYMENT_REQUEST_ABI } from "@qevie/sdk";
import { gaslessParams } from "../lib/gasless.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";

type Step = "form" | "created";

export default function Request(): React.ReactElement {
  const client = useQevieClient();
  const { address, signer } = useWallet();
  const gasStatus = useGasStatus(client, signer, address);

  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [memo, setMemo] = useState(params.get("memo") ?? "");
  const [step, setStep] = useState<Step>("form");
  const [payUri, setPayUri] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleCreate(): Promise<void> {
    if (address === null || signer === null) return;
    setIsLoading(true);
    setError(null);

    try {
      const amountUnits = BigInt(Math.round(Number(amount) * 1e6));
      const gas = await gaslessParams(client, address);
      const result = await client.requestPayment(signer, {
        from: from.trim() || undefined,
        amount: amountUnits,
        memo: memo.trim() || undefined,
        expirySeconds: 86400 * 30,
        ...gas,
      });

      const uri = buildPaymentUri({
        to: address,
        amount: amountUnits,
        memo: memo.trim() || undefined,
      });
      let nextShareUrl = `${APP_CONFIG.appBaseUrl}/pay?pay=${encodeURIComponent(uri)}`;
      if (result.txHash !== null) {
        try {
          const txReceipt = await client.publicClient.getTransactionReceipt({ hash: result.txHash });
          for (const log of txReceipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: PAYMENT_REQUEST_ABI,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === "RequestCreated") {
                const args = decoded.args as { requestId?: bigint };
                nextShareUrl = `${APP_CONFIG.appBaseUrl}/send?requestId=${args.requestId?.toString() ?? ""}`;
                break;
              }
            } catch {
              // ignore unrelated logs
            }
          }
        } catch {
          // fall back to generic payment link
        }
      }
      setPayUri(uri);
      setShareUrl(nextShareUrl);
      setStep("created");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create request");
    } finally {
      setIsLoading(false);
    }
  }

  if (step === "created" && payUri !== null) {
    return (
      <main className="page">
        <h2 style={{ marginBottom: "1.5rem" }}>Request created</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <QRCodeSVG value={payUri} size={200} bgColor="transparent" fgColor="var(--text)" />
          <p className="text-muted" style={{ fontSize: "0.8rem", wordBreak: "break-all", textAlign: "center" }}>
            {payUri}
          </p>
        </div>
          <button
          onClick={() => { void navigator.clipboard.writeText(shareUrl ?? `${APP_CONFIG.appBaseUrl}/pay?pay=${encodeURIComponent(payUri)}`); }}
          style={{ width: "100%", marginBottom: "0.75rem" }}
        >
          Copy share link
        </button>
        <button
          onClick={() => setStep("form")}
          style={{ width: "100%", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          New request
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h2 style={{ marginBottom: "1.5rem" }}>Request QUSDC</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            From (optional, leave blank for anyone)
          </label>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="bob.qie or 0x..."
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Amount (USD)
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Memo (optional)
          </label>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What for?" maxLength={31} />
        </div>
        {error !== null && <p className="text-error">{error}</p>}
        <GasStatusPanel status={gasStatus} />
        <button
          onClick={() => { void handleCreate(); }}
          disabled={
            !amount.trim() ||
            isLoading ||
            gasStatus.uiMode === "NEEDS_QUSDC" ||
            gasStatus.arming
          }
          style={{ width: "100%" }}
        >
          {isLoading ? <span className="spinner" /> : "Create request"}
        </button>
      </div>
    </main>
  );
}
