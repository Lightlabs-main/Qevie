import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type QevieReceipt } from "@qevie/sdk";
import { useQevieClient } from "@qevie/sdk/react";
import { APP_CONFIG } from "../config.js";

const EXPLORER = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

export default function ReceiptDetail(): React.ReactElement {
  const client = useQevieClient();
  const { receiptId } = useParams<{ receiptId: string }>();
  const [receipt, setReceipt] = useState<QevieReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        if (receiptId === undefined || !receiptId.startsWith("0x")) {
          throw new Error("Receipt not found.");
        }
        const nextReceipt = await client.getReceipt(receiptId as `0x${string}`);
        if (mounted) setReceipt(nextReceipt);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Receipt not found.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [client, receiptId]);

  const download = async (): Promise<void> => {
    if (receipt === null) return;
    const body = await client.exportReceipt(receipt.receiptId);
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qevie-receipt-${receipt.receiptId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">Verified Qevie Receipt</h2>
      </div>

      {loading && (
        <div className="flex-center" style={{ minHeight: "30vh" }}>
          <span className="spinner spinner-lg" />
        </div>
      )}

      {!loading && error !== null && (
        <div className="surface-card">
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Receipt unavailable</div>
          <div className="text-muted">{error}</div>
        </div>
      )}

      {!loading && error === null && receipt !== null && (
        <div className="tight-stack">
          <section className="surface-card">
            <div className="section-label">Verification</div>
            <div style={{ fontWeight: 700 }}>Verified from ReceiptRegistry on QIE.</div>
          </section>

          <section className="surface-card tight-stack">
            <DetailRow label="Receipt ID" value={receipt.receiptId} mono />
            <DetailRow label="Type" value={receipt.receiptType.replaceAll("_", " ")} />
            <DetailRow label="Payer" value={receipt.payer} mono />
            <DetailRow label="Payee" value={receipt.payee} mono />
            <DetailRow label="Token" value={`${receipt.tokenSymbol} · ${receipt.token}`} />
            <DetailRow label="Amount" value={receipt.amountPrivate ? "Private amount" : `$${receipt.amount ?? "0.00"}`} />
            <DetailRow label="Metadata Hash" value={receipt.metadataHash} mono />
            <DetailRow label="Transaction Hash" value={receipt.paymentReference ?? "Unavailable"} mono />
            <DetailRow label="Timestamp" value={new Date(receipt.timestamp * 1000).toLocaleString()} />
            <DetailRow label="Issuer" value={receipt.issuer} mono />
            <DetailRow label="Registry" value={client.config.contracts.receiptRegistry ?? "Not configured"} mono />
          </section>

          <section className="surface-card" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(receipt.receiptId); }}>
              Copy Receipt ID
            </button>
            <button className="btn-secondary btn-sm" onClick={() => { void download(); }}>
              Download JSON
            </button>
            {receipt.paymentReference !== undefined && (
              <a className="history-link" href={`${EXPLORER}/tx/${receipt.paymentReference}`} target="_blank" rel="noreferrer">
                Open Explorer ↗
              </a>
            )}
            <Link className="history-link" to="/passport">Back to Passport</Link>
          </section>
        </div>
      )}
    </main>
  );
}

function DetailRow(
  { label, value, mono = false }: { label: string; value: string; mono?: boolean },
): React.ReactElement {
  return (
    <div className="flex-between" style={{ gap: "var(--s-2)", alignItems: "flex-start" }}>
      <span className="text-muted" style={{ fontSize: "0.8rem" }}>{label}</span>
      <span style={{ textAlign: "right", fontFamily: mono ? "monospace" : undefined, fontSize: "0.82rem" }}>
        {value}
      </span>
    </div>
  );
}
