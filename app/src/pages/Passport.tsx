import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQevieClient } from "@qevie/sdk/react";
import { type Address } from "viem";
import { useWallet } from "../hooks/useWallet.js";

const PREF_PREFIX = "qevie_passport_visibility_v1:";

export default function Passport(): React.ReactElement {
  const client = useQevieClient();
  const { address } = useWallet();
  const params = useParams<{ accountOrUsername?: string }>();

  const [account, setAccount] = useState<Address | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passport, setPassport] = useState<Awaited<ReturnType<typeof client.getPassport>> | null>(null);
  const [showVolumePublicly, setShowVolumePublicly] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      setPassport(null);
      try {
        const raw = params.accountOrUsername?.trim();
        let nextAccount: Address | null = address;
        let nextAlias: string | null = null;

        if (raw !== undefined && raw !== "") {
          if (raw.startsWith("0x")) {
            nextAccount = raw as Address;
          } else {
            const resolved = await client.resolve(raw);
            if (resolved === null) {
              throw new Error("Invalid account or username.");
            }
            nextAccount = resolved;
            nextAlias = raw;
          }
        }

        if (nextAccount === null) {
          throw new Error("Connect a wallet or open a public passport link.");
        }

        if (client.config.contracts.receiptRegistry === undefined) {
          throw new Error("ReceiptRegistry is not configured on this network yet.");
        }

        const nextPassport = await client.getPassport(nextAccount);
        if (!mounted) return;
        setAccount(nextAccount);
        setAlias(nextAlias);
        setPassport(nextPassport);
        setShowVolumePublicly(loadVolumePreference(nextAccount));
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load passport");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [address, client, params.accountOrUsername]);

  const isOwnPassport = useMemo(
    () => account !== null && address !== null && account.toLowerCase() === address.toLowerCase(),
    [account, address],
  );

  const latestReceipts = passport?.latestReceipts ?? [];

  const handleToggle = (): void => {
    if (account === null) return;
    const next = !showVolumePublicly;
    setShowVolumePublicly(next);
    localStorage.setItem(`${PREF_PREFIX}${account.toLowerCase()}`, JSON.stringify(next));
  };

  const handleDownload = (): void => {
    if (passport === null) return;
    const body = JSON.stringify({
      app: "Qevie",
      generatedAt: new Date().toISOString(),
      passport: {
        ...passport,
        publicVolume: showVolumePublicly ? {
          sent: passport.qusdcVolumeSent ?? null,
          received: passport.qusdcVolumeReceived ?? null,
        } : null,
      },
    }, null, 2);
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qevie-passport-${passport.account}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyLink = (): void => {
    const path = alias !== null ? alias : account;
    if (path === null) return;
    void navigator.clipboard.writeText(`${window.location.origin}/passport/${path}`);
  };

  return (
    <main className="page fade-in">
      <div className="page-header">
        <h2 className="page-title">Qevie Passport</h2>
      </div>
      <p className="text-muted" style={{ marginBottom: "var(--s-3)" }}>
        Portable payment reputation for gasless QUSDC payments on QIE.
      </p>

      {loading && (
        <div className="flex-center" style={{ minHeight: "30vh" }}>
          <span className="spinner spinner-lg" />
        </div>
      )}

      {!loading && error !== null && (
        <div className="surface-card">
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Passport unavailable</div>
          <div className="text-muted">{error}</div>
        </div>
      )}

      {!loading && error === null && passport !== null && account !== null && (
        <div className="tight-stack">
          <section className="surface-card">
            <div className="section-label">Identity</div>
            <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>
              {alias ?? shorten(account)}
            </div>
            <div className="text-muted" style={{ fontSize: "0.8125rem" }}>
              Wallet: {account}
            </div>
            <div className="text-muted" style={{ fontSize: "0.8125rem", marginTop: "0.35rem" }}>
              Status: Verified by Qevie receipts
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "var(--s-2)", flexWrap: "wrap" }}>
              <button className="btn-secondary btn-sm" onClick={copyLink}>Copy Passport Link</button>
              <button className="btn-secondary btn-sm" onClick={handleDownload}>Download Passport Summary</button>
            </div>
          </section>

          <section className="tight-grid">
            <Metric label="Verified Receipts" value={`${passport.totalReceipts}`} />
            <Metric label="Payments Sent" value={`${passport.paymentsSent}`} />
            <Metric label="Payments Received" value={`${passport.paymentsReceived}`} />
            <Metric label="Subscriptions Completed" value={`${passport.subscriptionsCompleted}`} />
            <Metric label="Batch Payouts" value={`${passport.batchPayoutsSent}`} />
            <Metric label="Merchant Receipts" value={`${passport.merchantReceiptsReceived}`} />
          </section>

          <section className="surface-card">
            <div className="flex-between" style={{ gap: "var(--s-2)", marginBottom: "var(--s-2)" }}>
              <div>
                <div className="section-label">Volume</div>
                <div className="text-muted" style={{ fontSize: "0.8125rem" }}>
                  {showVolumePublicly
                    ? `Sent ${passport.qusdcVolumeSent ?? "Private"} QUSDC · Received ${passport.qusdcVolumeReceived ?? "Private"} QUSDC`
                    : "Volume hidden publicly. Receipt existence remains verifiable."}
                </div>
              </div>
              {isOwnPassport && (
                <button className="btn-secondary btn-sm" onClick={handleToggle}>
                  {showVolumePublicly ? "Public ON" : "Public OFF"}
                </button>
              )}
            </div>
          </section>

          <section className="surface-card">
            <div className="section-label">Latest Receipts</div>
            {latestReceipts.length === 0 ? (
              <div className="text-muted">No verified Qevie receipts yet.</div>
            ) : (
              <div className="tight-stack">
                {latestReceipts.map((receipt) => (
                  <div key={receipt.receiptId} className="history-feed-row">
                    <div>
                      <div style={{ fontWeight: 700 }}>{receipt.receiptType.replaceAll("_", " ")}</div>
                      <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                        {shorten(receipt.payer)} → {shorten(receipt.payee)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>
                        {receipt.amountPrivate ? "Private amount" : `$${receipt.amount ?? "0.00"}`}
                      </div>
                      <Link className="history-link" to={`/receipt/${receipt.receiptId}`}>View</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ padding: "var(--s-2)" }}>
      <div className="text-muted" style={{ fontSize: "0.75rem" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: "1.25rem" }}>{value}</div>
    </div>
  );
}

function shorten(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function loadVolumePreference(account: Address): boolean {
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${account.toLowerCase()}`);
    return raw === null ? false : JSON.parse(raw) as boolean;
  } catch {
    return false;
  }
}
