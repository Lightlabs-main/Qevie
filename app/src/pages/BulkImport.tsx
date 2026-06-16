import React, { useMemo, useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { buildPaymentUri } from "@qevie/sdk";
import { useWallet } from "../hooks/useWallet.js";
import { APP_CONFIG } from "../config.js";
import { gaslessParams } from "../lib/gasless.js";
import { isXlsx, xlsxToCsv } from "../lib/xlsx.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";
import {
  approveImportJob,
  confirmImportRows,
  createImportJob,
  getImportJob,
  sourceLabel,
  type ExecutionPlan,
  type JobView,
  type PaymentIntent,
} from "../lib/csvImport.js";

const SAMPLE_CSV = `type,recipient,amount,memo,schedule
pay,designer.qie,10,UI work,
pay,writer.qie,15,Article payment,
request,tobi.qie,5,Lunch,
subscription,dev.qie,20,Weekly dev,every Friday`;

type Phase = "upload" | "preview" | "executing" | "done";

type ImportRowKind = "valid" | "needs_review" | "blocked" | "duplicate";

function fmtQusdc(baseUnits: string): string {
  return (Number(baseUnits) / 1e6).toFixed(2);
}

function shortAddr(a?: string): string {
  if (a === undefined) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function intentTypeLabel(type: PaymentIntent["type"]): string {
  switch (type) {
    case "pay":
      return "Payment";
    case "request":
      return "Request";
    case "subscription":
      return "Subscription";
  }
}

function executionRailLabel(type: PaymentIntent["type"]): string {
  switch (type) {
    case "pay":
      return "Batch payment";
    case "request":
      return "Payment request";
    case "subscription":
      return "Subscription";
  }
}

function summaryRailLabel(intents: PaymentIntent[]): string {
  const active = intents.filter((intent) => intent.status !== "blocked");
  const types = [...new Set(active.map((intent) => intent.type))];
  if (types.length === 0) return "—";
  if (types.length === 1) return executionRailLabel(types[0] as PaymentIntent["type"]);
  return `Mixed rails (${types.map((type) => intentTypeLabel(type as PaymentIntent["type"])).join(", ")})`;
}

/** Action button label that counts each rail honestly (a request is not a pay). */
function approveButtonLabel(validRows: PaymentIntent[]): string {
  const pay = validRows.filter((r) => r.type === "pay").length;
  const request = validRows.filter((r) => r.type === "request").length;
  const subscription = validRows.filter((r) => r.type === "subscription").length;
  const parts = [
    pay > 0 ? `pay ${pay}` : null,
    request > 0 ? `request ${request}` : null,
    subscription > 0 ? `subscribe ${subscription}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "Approve & run" : `Approve & ${parts.join(" · ")}`;
}

/** Map a canonical schedule string to a period in seconds for `subscribe`. */
function periodFromCanonical(canonical?: string): number {
  const DAY = 86_400;
  const WEEK = 604_800;
  if (canonical === undefined || canonical === "") return WEEK;
  if (canonical === "monthly") return 30 * DAY;
  if (canonical.startsWith("weekly:every:")) {
    const n = Number(canonical.split(":")[2] ?? "1");
    return Math.max(1, n) * WEEK;
  }
  if (canonical.startsWith("weekly")) return WEEK;
  if (canonical.startsWith("daily")) {
    const n = Number(canonical.split(":")[1] ?? "1");
    return Math.max(1, n) * DAY;
  }
  return WEEK;
}

export default function BulkImport(): React.ReactElement {
  const client = useQevieClient();
  const { signer, address } = useWallet();
  const gasStatus = useGasStatus(client, signer, address);

  const [phase, setPhase] = useState<Phase>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("import.csv");
  const [view, setView] = useState<JobView | null>(null);
  const [allowDuplicateRows, setAllowDuplicateRows] = useState(false);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const intents = view?.intents ?? [];
  const job = view?.job ?? null;

  const duplicates = useMemo(
    () => intents.filter((i) => i.duplicateSeverity !== undefined && !removed.has(i.rowIndex)),
    [intents, removed],
  );
  const validRows = useMemo(
    () => intents.filter((i) => i.status === "valid" && i.duplicateSeverity === undefined),
    [intents],
  );
  const blocked = useMemo(
    () => intents.filter((i) => i.status === "blocked" && i.duplicateSeverity === undefined),
    [intents],
  );
  const needsReview = useMemo(() => intents.filter((i) => i.status === "needs_review"), [intents]);

  const onFile = async (file: File): Promise<void> => {
    setError(null);
    setFileName(file.name);
    try {
      // .xlsx is a zipped-XML workbook → flatten the first sheet to CSV. .csv
      // and .txt are read as plain text (the parser tolerates either).
      setCsvText(isXlsx(file) ? await xlsxToCsv(file) : await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file. Export it as CSV and retry.");
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (address === null) { setError("Connect your wallet first."); return; }
    if (csvText.trim() === "") { setError("Add a CSV first."); return; }
    setBusy(true); setError(null); setProgress("Parsing, resolving and checking for duplicates…");
    try {
      const result = await createImportJob({ fileName, csvText, smartAccount: address });
      setView(result);
      setAllowDuplicateRows(result.job.allowDuplicateRows);
      setRemoved(new Set());
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the import preview.");
    } finally { setBusy(false); setProgress(""); }
  };

  // Shareable link for a created payment request: a qevie: pay link wrapped in
  // the app's /pay route. Whoever opens it pays the requested amount to this
  // account. (PAYMENT_REQUEST_ABI exposes no event, so there's no on-chain
  // request id to wire a /send link to — this mirrors the Request page.)
  const buildRequestLink = (amount: string): string => {
    const uri = buildPaymentUri({ to: address as `0x${string}`, amount: BigInt(amount) });
    return `${APP_CONFIG.appBaseUrl}/pay?pay=${encodeURIComponent(uri)}`;
  };

  const executePlan = async (plan: ExecutionPlan): Promise<void> => {
    if (signer === null) throw new Error("Wallet not connected");
    const gas = await gaslessParams(client, address as `0x${string}`);
    const jobId = (job as JobView["job"]).jobId;

    // batchPay() pulls QUSDC from the smart account via the BatchPayments
    // contract, so that contract must be approved first or every batch reverts
    // (single transfers don't need this). One-time + idempotent.
    if (plan.payChunks.length > 0) {
      setProgress("Approving batch payments (one-time)…");
      const armed = await client.ensureBatchPaymentsReady(signer, gas);
      if (!armed.armed) {
        throw new Error(armed.reason ?? "Could not approve batch payments. Please try again.");
      }
    }

    for (const chunk of plan.payChunks) {
      setProgress(`Paying ${chunk.recipients.length} recipient(s)…`);
      const res = await client.batchPay(signer, {
        recipients: chunk.recipients.map((r) => ({ to: r.to, amount: BigInt(r.amount) })),
        batchId: chunk.batchId,
        ...gas,
      });
      // Only treat a row as paid when the userOp itself succeeded. A reverted
      // op can still be mined inside a successful tx (gas is charged, no funds
      // move); reporting that txHash would mark a failed payment "confirmed".
      const mined = res.status === "mined" && res.txHash !== null;
      await confirmImportRows(jobId, {
        rowIndexes: chunk.recipients.map((r) => r.rowIndex),
        userOpHash: res.userOpHash,
        ...(mined
          ? { txHash: res.txHash as `0x${string}`, receiptType: "BATCH_PAYMENT" as const }
          : { failed: res.status === "failed" }),
      });
      if (!mined && res.status === "failed") {
        throw new Error("A batch payment reverted on-chain — no funds moved. Nothing was charged except gas.");
      }
    }

    for (const single of plan.singles) {
      setProgress(`Submitting ${single.type} for ${shortAddr(single.to)}…`);
      const res = single.type === "request"
        ? await client.requestPayment(signer, { from: single.to, amount: BigInt(single.amount) })
        : await client.subscribe(signer, {
          payee: single.to,
          amount: BigInt(single.amount),
          period: periodFromCanonical(single.scheduleSpec),
          maxPayments: 12,
          ...gas,
        });
      const mined = res.status === "mined" && res.txHash !== null;
      const paymentLink = mined && single.type === "request"
        ? buildRequestLink(single.amount)
        : undefined;
      await confirmImportRows(jobId, {
        rowIndexes: [single.rowIndex],
        userOpHash: res.userOpHash,
        ...(mined ? { txHash: res.txHash as `0x${string}` } : { failed: res.status === "failed" }),
        ...(paymentLink !== undefined ? { paymentLink } : {}),
      });
    }
  };

  const handleApproveAndRun = async (): Promise<void> => {
    if (job === null) return;
    setBusy(true); setError(null); setPhase("executing");
    try {
      const overrides = [...removed].map((rowIndex) => ({ rowIndex, action: "remove" as const }));
      const result = await approveImportJob(job.jobId, {
        allowDuplicateRows,
        ...(overrides.length > 0 ? { rowOverrides: overrides } : {}),
      });
      if (result.plan !== undefined) {
        await executePlan(result.plan);
      }
      // Re-fetch so the summary reflects the post-execution outcome. result.job
      // is the pre-execution snapshot (confirmed = 0), which otherwise showed a
      // misleading "0 of N confirmed" even after rows settled.
      const refreshed = await getImportJob(job.jobId);
      setView(refreshed);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execution failed. You can resume from the job.");
      setPhase("preview");
    } finally { setBusy(false); setProgress(""); }
  };

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------
  if (phase === "upload") {
    return (
      <main className="page fade-in">
        <div className="page-header"><h2 className="page-title">Bulk Intent Import</h2></div>
        <p className="text-muted mb-4" style={{ fontSize: "0.8125rem" }}>
          Upload a CSV and Qevie turns each row into the action its <code>type</code> asks for —
          a payment, a payment request, or a subscription — all policy-checked.
          Duplicates are flagged, valid rows are batched, and re-uploading never double-pays.
        </p>

        <div className="input-group mb-4">
          <label className="input-label">CSV, TXT or XLSX file</label>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) void onFile(f); }}
          />
        </div>

        <div className="input-group mb-4">
          <label className="input-label">…or paste rows</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={SAMPLE_CSV}
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem", padding: "0.6rem" }}
          />
          <button className="btn-ghost" style={{ marginTop: "0.5rem" }} onClick={() => setCsvText(SAMPLE_CSV)}>
            Use sample
          </button>
        </div>

        {error !== null && <div className="alert alert-error mb-3">{error}</div>}

        <button
          className="btn-primary btn-lg"
          onClick={() => { void handlePreview(); }}
          disabled={busy || csvText.trim() === ""}
        >
          {busy ? <><span className="spinner" style={{ width: 18, height: 18 }} /> {progress || "Working…"}</> : "Build preview"}
        </button>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  if (phase === "done" && job !== null) {
    const requestLinks = intents.filter(
      (i) => i.type === "request" && i.status === "confirmed" && typeof i.paymentLink === "string",
    );
    return (
      <main className="page fade-in">
        <div style={{ textAlign: "center", paddingTop: "2rem" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
          <h1 style={{ marginBottom: "0.5rem" }}>Import {job.status === "completed" ? "complete" : "submitted"}</h1>
          <p className="text-muted">{job.counts.confirmed} of {job.counts.total} rows confirmed</p>
        </div>

        {requestLinks.length > 0 && (
          <div className="card" style={{ padding: "1rem", marginTop: "1.5rem", textAlign: "left" }}>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.25rem" }}>Payment links to share</h3>
            <p className="text-muted" style={{ fontSize: "0.75rem", margin: "0 0 0.75rem" }}>
              Send these to whoever should pay each request.
            </p>
            {requestLinks.map((i) => (
              <div key={i.rowIndex} style={{ marginBottom: "0.75rem" }}>
                <div className="text-muted" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                  Request ${fmtQusdc(i.amount)} · {i.recipientInput}
                </div>
                <div className="flex-between" style={{ gap: "0.5rem" }}>
                  <input
                    readOnly
                    value={i.paymentLink}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: 1, fontSize: "0.7rem", padding: "0.4rem", fontFamily: "monospace" }}
                  />
                  <button className="btn-ghost" onClick={() => { void navigator.clipboard.writeText(i.paymentLink as string); }}>
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: "center" }}>
          <button
            className="btn-secondary btn-lg"
            style={{ marginTop: "2rem" }}
            onClick={() => { setPhase("upload"); setView(null); setCsvText(""); }}
          >
            New import
          </button>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Preview / executing
  // -------------------------------------------------------------------------
  return (
    <main className="page fade-in">
      <div className="page-header"><h2 className="page-title">CSV Import Summary</h2></div>

      {job !== null && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <SummaryRow label="Rows found" value={String(job.counts.total)} />
          <SummaryRow label="Valid" value={String(job.counts.valid)} />
          <SummaryRow label="Duplicates" value={String(job.counts.duplicates)} />
          <SummaryRow label="Needs review" value={String(job.counts.needsReview)} />
          <SummaryRow label="Blocked" value={String(job.counts.blocked)} />
          <SummaryRow label="Total to pay" value={`$${fmtQusdc(job.totalBaseUnits)}`} accent />
          <SummaryRow label="Execution rail" value={summaryRailLabel(intents)} />
          <SummaryRow label="Gas mode" value={job.gasMode ?? "—"} />
        </div>
      )}

      {validRows.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Valid rows</h3>
          {validRows.map((intent) => (
            <ImportRowCard key={intent.rowIndex} intent={intent} kind="valid" />
          ))}
        </div>
      )}

      {needsReview.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Needs review</h3>
          {needsReview.map((intent) => (
            <ImportRowCard key={intent.rowIndex} intent={intent} kind="needs_review" />
          ))}
        </div>
      )}

      {duplicates.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Duplicate warnings</h3>
          {duplicates.map((i) => (
            <DuplicateCard key={i.rowIndex} intent={i} onRemove={() => setRemoved((p) => new Set(p).add(i.rowIndex))} />
          ))}
        </div>
      )}

      {blocked.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Blocked rows</h3>
          {blocked.map((i) => (
            <ImportRowCard key={i.rowIndex} intent={i} kind="blocked" />
          ))}
        </div>
      )}

      <label className="flex-between card" style={{ padding: "0.75rem", marginBottom: "1rem", cursor: "pointer" }}>
        <span className="text-muted" style={{ fontSize: "0.8rem" }}>
          Execute blocking duplicates anyway (off by default)
        </span>
        <input
          type="checkbox"
          checked={allowDuplicateRows}
          onChange={(e) => setAllowDuplicateRows(e.target.checked)}
        />
      </label>

      <div className="mb-4"><GasStatusPanel status={gasStatus} /></div>

      {error !== null && <div className="alert alert-error mb-3">{error}</div>}

      <button
        className="btn-primary btn-lg"
        onClick={() => { void handleApproveAndRun(); }}
        disabled={busy || validRows.length === 0 || gasStatus.uiMode === "NEEDS_QUSDC" || gasStatus.arming}
      >
        {busy
          ? <><span className="spinner" style={{ width: 18, height: 18 }} /> {progress || "Executing…"}</>
          : approveButtonLabel(validRows)}
      </button>
    </main>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.ReactElement {
  return (
    <div className="flex-between" style={{ padding: "0.25rem 0" }}>
      <span className="text-muted" style={{ fontSize: "0.8rem" }}>{label}</span>
      <span style={{ fontWeight: accent === true ? 800 : 600, color: accent === true ? "var(--accent-light)" : undefined }}>
        {value}
      </span>
    </div>
  );
}

function DuplicateCard({ intent, onRemove }: { intent: PaymentIntent; onRemove: () => void }): React.ReactElement {
  const warning = intent.warnings[0];
  return (
    <div>
      <ImportRowCard intent={intent} kind="duplicate" />
      <button className="btn-ghost" style={{ marginTop: "0.4rem", fontSize: "0.75rem" }} onClick={onRemove}>
        Remove from import
      </button>
      <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
        {warning?.message ?? "Possible duplicate."} ({intent.duplicateSeverity === "block" ? "blocks by default" : "warning"})
      </div>
    </div>
  );
}

function ImportRowCard({
  intent,
  kind,
}: {
  intent: PaymentIntent;
  kind: ImportRowKind;
}): React.ReactElement {
  const borderColor =
    kind === "blocked"
      ? "var(--error)"
      : kind === "duplicate" || kind === "needs_review"
        ? "var(--warning)"
        : "var(--success)";
  const detail =
    kind === "blocked"
      ? intent.parseErrors?.join(" ") || intent.blockReason || "Blocked."
      : kind === "needs_review"
        ? intent.blockReason || "This row may exceed a policy window and will still be checked onchain."
        : `${executionRailLabel(intent.type)}${intent.scheduleSpec !== undefined ? ` · ${intent.scheduleSpec}` : ""}`;

  return (
    <div
      className="card"
      style={{ padding: "0.75rem", marginBottom: "0.5rem", borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex-between" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, overflowWrap: "anywhere" }}>
            Row {intent.rowIndex + 1}: {intentTypeLabel(intent.type)} · {intent.recipientInput}
          </div>
          <div className="text-muted" style={{ fontSize: "0.72rem", overflowWrap: "anywhere" }}>
            {intent.resolvedAddress !== undefined
              ? `${shortAddr(intent.resolvedAddress)} · ${sourceLabel(intent.resolutionSource)}`
              : "Unresolved recipient"}
          </div>
        </div>
        <div style={{ flexShrink: 0, fontWeight: 700, color: "var(--accent-light)" }}>
          ${fmtQusdc(intent.amount)}
        </div>
      </div>
      {intent.memo !== "" && (
        <div className="text-muted" style={{ fontSize: "0.72rem", marginTop: "0.25rem" }}>
          Memo: {intent.memo}
        </div>
      )}
      <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: "0.3rem" }}>
        {detail}
      </div>
    </div>
  );
}
