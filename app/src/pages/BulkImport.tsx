import React, { useMemo, useState } from "react";
import { useQevieClient } from "@qevie/sdk/react";
import { useWallet } from "../hooks/useWallet.js";
import { gaslessParams } from "../lib/gasless.js";
import { isXlsx, xlsxToCsv } from "../lib/xlsx.js";
import { useGasStatus } from "../lib/useGasStatus.js";
import { GasStatusPanel } from "../components/GasStatusPanel.js";
import {
  approveImportJob,
  confirmImportRows,
  createImportJob,
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

function fmtQusdc(baseUnits: string): string {
  return (Number(baseUnits) / 1e6).toFixed(2);
}

function shortAddr(a?: string): string {
  if (a === undefined) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
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

  const executePlan = async (plan: ExecutionPlan): Promise<void> => {
    if (signer === null) throw new Error("Wallet not connected");
    const gas = await gaslessParams(client, address as `0x${string}`);
    const jobId = (job as JobView["job"]).jobId;

    for (const chunk of plan.payChunks) {
      setProgress(`Paying ${chunk.recipients.length} recipient(s)…`);
      const res = await client.batchPay(signer, {
        recipients: chunk.recipients.map((r) => ({ to: r.to, amount: BigInt(r.amount) })),
        batchId: chunk.batchId,
        ...gas,
      });
      await confirmImportRows(jobId, {
        rowIndexes: chunk.recipients.map((r) => r.rowIndex),
        userOpHash: res.userOpHash,
        ...(res.txHash !== null ? { txHash: res.txHash } : {}),
        receiptType: "BATCH_PAYMENT",
      });
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
      await confirmImportRows(jobId, {
        rowIndexes: [single.rowIndex],
        userOpHash: res.userOpHash,
        ...(res.txHash !== null ? { txHash: res.txHash } : {}),
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
      setView((prev) => (prev !== null ? { ...prev, job: result.job } : prev));
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
          Upload a CSV and Qevie turns each row into a policy-checked QUSDC payment.
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
    return (
      <main className="page fade-in">
        <div style={{ textAlign: "center", paddingTop: "2rem" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
          <h1 style={{ marginBottom: "0.5rem" }}>Import {job.status === "completed" ? "complete" : "submitted"}</h1>
          <p className="text-muted">{job.counts.confirmed} of {job.counts.total} rows confirmed</p>
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
          <SummaryRow label="Total QUSDC" value={`$${fmtQusdc(job.totalBaseUnits)}`} accent />
          <SummaryRow label="Execution rail" value={job.rail ?? "—"} />
          <SummaryRow label="Gas mode" value={job.gasMode ?? "—"} />
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

      {needsReview.length > 0 && (
        <div className="alert mb-3" style={{ background: "var(--warn-dim, #2a2410)", fontSize: "0.8rem" }}>
          {needsReview.length} row(s) need review (may exceed a policy window). They will be attempted; the chain is the backstop.
        </div>
      )}

      {blocked.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Blocked rows</h3>
          {blocked.map((i) => (
            <div key={i.rowIndex} className="card" style={{ padding: "0.6rem 0.75rem", marginBottom: "0.4rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                Row {i.rowIndex + 1}: {i.recipientInput} · ${fmtQusdc(i.amount)}
              </div>
              <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                {i.blockReason ?? (i.parseErrors ?? []).join(" ") ?? "Blocked."}
              </div>
            </div>
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
        disabled={busy || (job?.counts.valid ?? 0) === 0 || gasStatus.uiMode === "NEEDS_QUSDC" || gasStatus.arming}
      >
        {busy
          ? <><span className="spinner" style={{ width: 18, height: 18 }} /> {progress || "Executing…"}</>
          : `Approve & pay ${job?.counts.valid ?? 0} valid row(s)`}
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
    <div className="card" style={{ padding: "0.75rem", marginBottom: "0.5rem", borderLeft: "3px solid var(--warn, #d6a400)" }}>
      <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
        {intent.recipientInput} → {shortAddr(intent.resolvedAddress)}
        <span className="text-muted" style={{ fontWeight: 400 }}> · {sourceLabel(intent.resolutionSource)}</span>
      </div>
      <div style={{ fontSize: "0.85rem", margin: "0.15rem 0" }}>${fmtQusdc(intent.amount)} QUSDC</div>
      <div className="text-muted" style={{ fontSize: "0.75rem" }}>
        {warning?.message ?? "Possible duplicate."} ({intent.duplicateSeverity === "block" ? "blocks by default" : "warning"})
      </div>
      <button className="btn-ghost" style={{ marginTop: "0.4rem", fontSize: "0.75rem" }} onClick={onRemove}>
        Remove from import
      </button>
    </div>
  );
}
