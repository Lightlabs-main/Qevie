import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import type { UserOpResult } from "@qevie/sdk";
import type { CreateReceiptResult, ResolvedRecipient } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";
import { gaslessParams } from "../lib/gasless.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";
import { PAYMENT_REQUEST_ABI } from "@qevie/sdk";
import { hexToString, type Address } from "viem";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

type Step = "form" | "confirm" | "sending" | "done";

export default function Send(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();
  const [params] = useSearchParams();
  const requestId = params.get("requestId");

  const [to, setTo] = useState(params.get("to") ?? "");
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [memo, setMemo] = useState(params.get("memo") ?? "");
  const [step, setStep] = useState<Step>("form");
  const [result, setResult] = useState<UserOpResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState<CreateReceiptResult | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null);
  const [resolvedInfo, setResolvedInfo] = useState<ResolvedRecipient | null>(null);
  const [resolving, setResolving] = useState(false);
  const gasStatus = useGasStatus(client, signer, address);

  useEffect(() => {
    if (requestId === null) return;
    let mounted = true;
    void (async () => {
      setResolving(true);
      setError(null);
      try {
        const request = await client.publicClient.readContract({
          address: client.config.contracts.paymentRequest,
          abi: PAYMENT_REQUEST_ABI,
          functionName: "getRequest",
          args: [BigInt(requestId)],
        }) as {
          requestor: Address;
          payer: Address;
          amount: bigint;
          memo: `0x${string}`;
          expiry: bigint;
          status: number;
        };

        if (!mounted) return;
        setResolvedAddr(request.requestor);
        setTo(request.requestor);
        setAmount((Number(request.amount) / 1e6).toString());
        const memoText = hexToString(request.memo, { size: 32 }).replace(/\0+$/g, "");
        if (memoText !== "") setMemo(memoText);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load request");
      } finally {
        if (mounted) setResolving(false);
      }
    })();
    return () => { mounted = false; };
  }, [client, requestId]);

  const handlePreview = async (): Promise<void> => {
    if (requestId !== null) {
      if (resolvedAddr === null || !amount.trim()) return;
      setStep("confirm");
      return;
    }
    if (!to.trim() || !amount.trim()) return;
    setError(null);
    setResolving(true);
    try {
      const resolved = await client.resolveDetailed(to.trim());
      if (!resolved.ok) {
        setError(resolved.message);
        return;
      }
      setResolvedAddr(resolved.address);
      setResolvedInfo(resolved);
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolution failed");
    } finally {
      setResolving(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    if (signer === null || address === null) { setError("Wallet not connected"); return; }
    setStep("sending");
    setError(null);
    setResult(null);
    try {
      const amountUnits = BigInt(Math.round(parseFloat(amount) * 1e6));
      const gas = await gaslessParams(client, address);
      const isRequestSettlement = requestId !== null;
      if (isRequestSettlement) {
        const res = await client.payRequest(signer, {
          requestId: BigInt(requestId),
          ...gas,
        });
        setStep("done");
        setResult(res);
        if (res.status !== "failed" && APP_CONFIG.contracts.receiptRegistry !== undefined && res.txHash !== null) {
          try {
            const created = await client.createReceipt({
              payer: address,
              payee: resolvedAddr as `0x${string}` ?? to.trim() as `0x${string}`,
              token: APP_CONFIG.contracts.qusdc,
              amount,
              amountPrivate: false,
              receiptType: "PAYMENT_REQUEST_SETTLED",
              paymentReference: res.txHash,
              metadata: {
                memo: memo.trim() || null,
                source: "request-settlement-flow",
                requestId,
                txHash: res.txHash,
                userOpHash: res.userOpHash,
              },
            });
            setReceipt(created);
            setReceiptError(null);
          } catch (receiptFailure) {
            setReceiptError(
              receiptFailure instanceof Error
                ? receiptFailure.message
                : "Payment succeeded, but receipt creation failed.",
            );
          }
        }
        return;
      }

      const userOpHash = await client.paySubmit(signer, {
        to: to.trim(),
        amount: amountUnits,
        memo: memo.trim() || undefined,
        ...gas,
      });
      setConfirming(true);
      setStep("done");
      // Reconcile the onchain receipt in the background.
      client.bundler
        .waitForUserOp(userOpHash)
        .then(async (res) => {
          if (res.status === "failed") {
            setError("Payment was submitted but failed onchain.");
          } else {
            setResult(res);
            if (APP_CONFIG.contracts.receiptRegistry !== undefined && res.txHash !== null) {
              try {
                const created = await client.createReceipt({
                  payer: address,
                  payee: resolvedAddr as `0x${string}` ?? to.trim() as `0x${string}`,
                  token: APP_CONFIG.contracts.qusdc,
                  amount,
                  amountPrivate: false,
                  receiptType: "SINGLE_PAYMENT",
                  paymentReference: res.txHash,
                  metadata: {
                    memo: memo.trim() || null,
                    source: "send-flow",
                    txHash: res.txHash,
                    userOpHash,
                  },
                });
                setReceipt(created);
                setReceiptError(null);
              } catch (receiptFailure) {
                setReceiptError(
                  receiptFailure instanceof Error
                    ? receiptFailure.message
                    : "Payment succeeded, but receipt creation failed.",
                );
              }
            }
          }
        })
        .catch(() => { /* keep the optimistic "submitted" state */ })
        .finally(() => setConfirming(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setStep("confirm");
    }
  };

  if (step === "done") {
    const confirmed = result !== null && result.status === "mined";
    const txHash = result?.txHash ?? null;
    return (
      <main className="page fade-in">
        <div style={{ textAlign: "center", paddingTop: "2rem" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>{confirmed ? "✅" : "📤"}</div>
          <h1 style={{ marginBottom: "0.5rem" }}>{confirmed ? "Sent!" : "Payment submitted"}</h1>

          {confirmed ? (
            <p className="text-muted">
              {requestId === null
                ? "Your QUSDC payment was confirmed onchain."
                : "Your payment request settlement was confirmed onchain."}
            </p>
          ) : error !== null ? (
            <p className="text-muted">{error}</p>
          ) : confirming ? (
            <p className="text-muted" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="spinner" style={{ width: 16, height: 16 }} /> Confirming onchain…
            </p>
          ) : (
            <p className="text-muted">Payment was submitted to the network.</p>
          )}

          {txHash !== null && (
            <a
              href={`${EXPLORER}/tx/${txHash}`}
              target="_blank" rel="noreferrer"
              className="chip chip-accent"
              style={{ display: "inline-flex", marginTop: "1.5rem", textDecoration: "none" }}
            >
              View transaction →
            </a>
          )}

          {receipt !== null && (
            <a
              href={`/receipt/${receipt.receiptId}`}
              className="chip chip-success"
              style={{ display: "inline-flex", marginTop: "0.75rem", textDecoration: "none" }}
            >
              View receipt →
            </a>
          )}
          {receiptError !== null && (
            <p className="text-muted" style={{ marginTop: "0.75rem", fontSize: "0.8125rem" }}>
              {receiptError}
            </p>
          )}

          <button
            className="btn-secondary btn-lg"
            onClick={() => {
              setStep("form"); setResult(null); setConfirming(false); setError(null);
              setReceipt(null); setReceiptError(null);
              setTo(""); setAmount(""); setMemo("");
            }}
            style={{ marginTop: "2rem" }}
          >
            Send another
          </button>
        </div>
      </main>
    );
  }

  if (step === "sending") {
    return (
      <main className="page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <span className="spinner spinner-lg" />
        <p style={{ marginTop: "1.25rem", fontWeight: 600 }}>Sending payment…</p>
        <p className="text-muted mt-2" style={{ fontSize: "0.8125rem" }}>Submitting to bundler, this may take a moment</p>
      </main>
    );
  }

  if (step === "confirm") {
    const amountNum = parseFloat(amount);
    return (
      <main className="page fade-in">
        <div className="page-header">
          <button className="back-btn" onClick={() => setStep("form")}>←</button>
          <h2 className="page-title">Confirm</h2>
        </div>

        <div className="card mb-4">
          <div className="row">
            <span className="row-label">To</span>
            <span className="row-value mono truncate" style={{ maxWidth: "60%", fontSize: "0.8rem" }}>
              {resolvedAddr}
            </span>
          </div>
          {resolvedInfo !== null && resolvedInfo.source !== "direct_address" && (
            <div className="row">
              <span className="row-label">Resolved</span>
              <span className="row-value" style={{ fontSize: "0.75rem" }}>
                {resolvedInfo.displayName ?? resolvedInfo.input}
                {" · "}
                {resolvedInfo.source === "qie_domain_resolver"
                  ? (resolvedInfo.verified ? "QIE Domain ✓" : "QIE Domain (unverified)")
                  : "Qevie username"}
              </span>
            </div>
          )}
          <div className="row">
            <span className="row-label">Amount</span>
            <span className="row-value" style={{ color: "var(--accent-light)" }}>
              ${amountNum.toFixed(2)} QUSDC
            </span>
          </div>
          {memo && (
            <div className="row">
              <span className="row-label">Memo</span>
              <span className="row-value">{memo}</span>
            </div>
          )}
          {requestId !== null && (
            <div className="row">
              <span className="row-label">Request</span>
              <span className="row-value">#{requestId}</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <GasStatusPanel status={gasStatus} />
        </div>

        {error !== null && <div className="alert alert-error mb-3">{error}</div>}

        <button
          className="btn-primary btn-lg"
          disabled={gasStatus.uiMode === "NEEDS_QUSDC" || gasStatus.arming}
          onClick={() => { void handleSend(); }}
        >
          {gasStatus.uiMode === "NEEDS_QUSDC"
            ? "Add USDC to pay network fee"
            : `Send $${amountNum.toFixed(2)} QUSDC`}
        </button>
      </main>
    );
  }

  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">Send QUSDC</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="input-group">
          <label className="input-label">To</label>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="address, username, or name.qie"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Amount (USD)</label>
          <div className="input-with-suffix" style={{ position: "relative" }}>
            <input
              type="number" min="0.01" step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ paddingRight: "5rem" }}
            />
            <span className="input-suffix">QUSDC</span>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Memo <span className="text-dim">(optional)</span></label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What's this for?"
            maxLength={31}
          />
        </div>

        {error !== null && <div className="alert alert-error">{error}</div>}

        <button
          className="btn-primary btn-lg"
          onClick={() => { void handlePreview(); }}
          disabled={!to.trim() || !amount.trim() || resolving}
          style={{ marginTop: "0.5rem" }}
        >
          {resolving ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Resolving…</> : "Preview"}
        </button>
      </div>
    </main>
  );
}
