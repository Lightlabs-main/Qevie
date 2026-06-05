import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildPaymentUri } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";

type Mode = "single" | "split";

interface LinkMeta {
  uri: string;
  shareUrl: string;
  amount?: bigint;
  maxUses?: number;
  expiry?: string;
  label: string;
  copied: boolean;
}

function buildUri(params: {
  to: string;
  amount?: string;
  memo?: string;
  maxUses?: string;
  expiry?: string;
}): string {
  const amountBig = params.amount ? BigInt(Math.round(parseFloat(params.amount) * 1e6)) : undefined;
  const expiryDelta = params.expiry
    ? Math.max(0, Math.floor((new Date(params.expiry).getTime() - Date.now()) / 1000))
    : undefined;

  const base = buildPaymentUri({ to: params.to, amount: amountBig, memo: params.memo || undefined, expirySeconds: expiryDelta });

  const extra = new URLSearchParams();
  if (params.maxUses && parseInt(params.maxUses) > 0) extra.set("maxUses", params.maxUses);
  if (params.expiry) extra.set("expires", params.expiry);

  const qs = extra.toString();
  const uri = qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;

  const shareUrl = `${APP_CONFIG.appBaseUrl}/pay?pay=${encodeURIComponent(uri)}`;
  return shareUrl;
}

export default function PaymentLinks(): React.ReactElement {
  const { address } = useWallet();

  const [mode, setMode] = useState<Mode>("single");

  // Form fields
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiry, setExpiry] = useState("");
  const [splitCount, setSplitCount] = useState("3");

  // Results
  const [links, setLinks] = useState<LinkMeta[] | null>(null);
  const [showQR, setShowQR] = useState<number | null>(null);

  const minExpiry = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  const generate = (): void => {
    const to = recipient.trim() || (address ?? "");
    if (!to) return;

    const count = mode === "split" ? Math.max(1, Math.min(50, parseInt(splitCount) || 1)) : 1;

    const newLinks: LinkMeta[] = [];
    for (let i = 0; i < count; i++) {
      const label = mode === "split" ? `Link ${i + 1} of ${count}` : "Payment link";
      const memo_ = mode === "split" && count > 1
        ? `${memo.trim() ? memo.trim() + " " : ""}(${i + 1}/${count})`
        : memo.trim() || undefined;

      const base = buildPaymentUri({
        to,
        amount: amount ? BigInt(Math.round(parseFloat(amount) * 1e6)) : undefined,
        memo: memo_,
        expirySeconds: expiry
          ? Math.max(0, Math.floor((new Date(expiry).getTime() - Date.now()) / 1000))
          : undefined,
      });

      const extra = new URLSearchParams();
      if (maxUses && parseInt(maxUses) > 0) extra.set("maxUses", maxUses);
      if (expiry) extra.set("expires", expiry);
      const qs = extra.toString();
      const uri = qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
      const shareUrl = `${APP_CONFIG.appBaseUrl}/pay?pay=${encodeURIComponent(uri)}`;

      newLinks.push({
        uri,
        shareUrl,
        amount: amount ? BigInt(Math.round(parseFloat(amount) * 1e6)) : undefined,
        maxUses: maxUses && parseInt(maxUses) > 0 ? parseInt(maxUses) : undefined,
        expiry: expiry || undefined,
        label,
        copied: false,
      });
    }

    setLinks(newLinks);
    setShowQR(null);
  };

  const copyLink = (idx: number): void => {
    if (!links) return;
    const url = links[idx]?.shareUrl ?? "";
    void navigator.clipboard.writeText(url);
    setLinks((prev) => prev?.map((l, i) => i === idx ? { ...l, copied: true } : l) ?? null);
    setTimeout(() => setLinks((prev) => prev?.map((l, i) => i === idx ? { ...l, copied: false } : l) ?? null), 1800);
  };

  const copyAll = (): void => {
    if (!links) return;
    void navigator.clipboard.writeText(links.map((l) => l.shareUrl).join("\n"));
  };

  const reset = (): void => { setLinks(null); setShowQR(null); };

  // ── Results view ────────────────────────────────
  if (links !== null) {
    return (
      <main className="page fade-in">
        <div className="page-header">
          <button className="back-btn" onClick={reset}>←</button>
          <h2 className="page-title">
            {links.length === 1 ? "Payment link" : `${links.length} links generated`}
          </h2>
          {links.length > 1 && (
            <button className="btn-secondary btn-sm" onClick={copyAll}>Copy all</button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {links.map((link, idx) => (
            <div key={idx} className="link-card fade-in" style={{ animationDelay: `${idx * 0.05}s` }}>
              <div className="flex-between">
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{link.label}</span>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {link.amount !== undefined && (
                    <span className="chip chip-accent">${(Number(link.amount) / 1e6).toFixed(2)}</span>
                  )}
                  {link.maxUses !== undefined && (
                    <span className="chip chip-muted">max {link.maxUses}×</span>
                  )}
                  {link.expiry !== undefined && (
                    <span className="chip chip-muted">
                      exp {new Date(link.expiry).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <div className="link-url">{link.shareUrl}</div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className={`btn-sm ${link.copied ? "btn-secondary" : "btn-primary"}`}
                  onClick={() => copyLink(idx)}
                  style={{ flex: 1 }}
                >
                  {link.copied ? "✓ Copied" : "Copy link"}
                </button>
                <button
                  className="btn-secondary btn-sm btn-icon"
                  onClick={() => setShowQR(showQR === idx ? null : idx)}
                  title="Show QR code"
                  style={{ padding: "0.5rem 0.75rem", flexShrink: 0 }}
                >
                  ⊞
                </button>
              </div>

              {showQR === idx && (
                <div className="flex-center fade-in" style={{ flexDirection: "column", gap: "0.75rem" }}>
                  <div className="qr-wrap">
                    <QRCodeSVG value={link.uri} size={180} />
                  </div>
                  <p className="text-muted" style={{ fontSize: "0.75rem", textAlign: "center" }}>
                    Scan to open in Qevie
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <button className="btn-ghost btn-lg" onClick={reset} style={{ marginTop: "1.5rem" }}>
          Generate new links
        </button>
      </main>
    );
  }

  // ── Form view ────────────────────────────────────
  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">Payment Links</h2>
      </div>

      {/* Mode toggle */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${mode === "single" ? "active" : ""}`}
            onClick={() => setMode("single")}
          >
            🔗 Single link
          </button>
          <button
            className={`toggle-btn ${mode === "split" ? "active" : ""}`}
            onClick={() => setMode("split")}
          >
            ⊗ Split links
          </button>
        </div>
        <p className="text-muted mt-2" style={{ fontSize: "0.8125rem" }}>
          {mode === "single"
            ? "Generate one shareable payment request link."
            : "Generate multiple links at once — perfect for splitting bills or group payments."}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Recipient */}
        <div className="input-group">
          <label className="input-label">
            Recipient <span className="text-dim">(optional — leave blank to receive yourself)</span>
          </label>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={address ? `${address.slice(0, 10)}… (you)` : "address or username"}
            autoCapitalize="none"
          />
        </div>

        {/* Amount */}
        <div className="input-group">
          <label className="input-label">Amount <span className="text-dim">(optional)</span></label>
          <div style={{ position: "relative" }}>
            <input
              type="number" min="0.01" step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Leave blank for open amount"
              style={{ paddingRight: "5rem" }}
            />
            <span className="input-suffix">QUSDC</span>
          </div>
        </div>

        {/* Memo */}
        <div className="input-group">
          <label className="input-label">Memo <span className="text-dim">(optional)</span></label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What's it for?"
            maxLength={31}
          />
        </div>

        {/* Divider — link settings */}
        <div className="divider-with-text">Link settings</div>

        {/* Max uses */}
        <div className="input-group">
          <label className="input-label">
            Max uses <span className="text-dim">(optional — how many times the link can be used)</span>
          </label>
          <input
            type="number" min="1" step="1"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        {/* Expiration */}
        <div className="input-group">
          <label className="input-label">
            Expires <span className="text-dim">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            min={minExpiry}
            style={{ colorScheme: "dark" }}
          />
        </div>

        {/* Split count */}
        {mode === "split" && (
          <div className="input-group">
            <label className="input-label">Number of links</label>
            <input
              type="number" min="2" max="50" step="1"
              value={splitCount}
              onChange={(e) => setSplitCount(e.target.value)}
              placeholder="3"
            />
            {amount && parseInt(splitCount) > 1 && (
              <p className="text-muted mt-1" style={{ fontSize: "0.8125rem" }}>
                Each link is for ${(parseFloat(amount) || 0).toFixed(2)} QUSDC
              </p>
            )}
          </div>
        )}

        <button
          className="btn-primary btn-lg"
          onClick={generate}
          disabled={!recipient.trim() && !address}
          style={{ marginTop: "0.5rem" }}
        >
          {mode === "split"
            ? `Generate ${parseInt(splitCount) || 1} links`
            : "Generate link"}
        </button>
      </div>
    </main>
  );
}
