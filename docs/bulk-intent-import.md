# Bulk Intent Import (CSV → policy-checked QUSDC execution)

Upload a CSV and Qevie turns each row into a reviewable, policy-checked QUSDC
**payment intent** — never an immediate transfer. Duplicates are detected
(including across re-uploads and history) and blocked by default; valid rows are
batched; every confirmed payment writes a receipt linked back to the import job;
and retries / crashes / re-uploads can never double-pay.

Internal name: **Bulk Intent Import**. The Autopilot-driven path is surfaced in
product copy as **CSV-to-Autopilot**.

This is an **additive** orchestration layer on top of primitives that already
exist (`batchPay`, `executeAutopilotPayment`, `resolveDetailed`, the
AgentPolicyManager, ReceiptRegistry). It adds no new contracts and changes no
existing flow.

---

## Where the code lives

| Layer | Path | Responsibility |
| --- | --- | --- |
| SDK (pure) | `sdk/src/csv/*` | Deterministic parse, normalize, schedule validator, key derivation, duplicate detection, policy mirror, chunking, idempotent selection. Unit-tested in `sdk/src/csv/csv.test.ts`. |
| Service | `paymaster-service/src/csv-import.ts`, `csv-import-store.ts` | Job state machine, JSON persistence, resolution, on-chain policy reads, the Autopilot executor loop, receipts. |
| App | `app/src/pages/BulkImport.tsx`, `app/src/lib/csvImport.ts` | The `/import` screen: upload → preview → approve → user-signed execution. |

The SDK layer is environment-agnostic on purpose: the service and the app both
import the *same* deterministic functions, so parsing, hashing, dedup, and
id-derivation behave identically everywhere and the money path stays testable
with no network and no LLM.

---

## CSV contract

```csv
type,recipient,amount,memo,schedule
pay,designer.qie,10,UI work,
pay,writer.qie,15,Article payment,
request,tobi.qie,5,Lunch,
subscription,dev.qie,20,Weekly dev,every Friday
```

- `type ∈ {pay, request, subscription}`.
- `amount` in human QUSDC, converted **once** to 6-decimal base units.
- `schedule` is valid **only** for `subscription`, parsed by a deterministic
  validator (`every Friday`, `weekly`, `daily`, `monthly`, `every 2 weeks`, …).
  Anything it does not understand is a row error, never a guess. No LLM is used.
- Columns may be reordered; `memo`/`schedule` are optional columns. Missing
  `type`/`recipient`/`amount` columns reject the **whole file**; per-row problems
  never abort the file.

**Accepted upload formats:** `.csv`, `.txt` (read as plain text), and `.xlsx`.
`.xlsx` is parsed in-browser with a dependency-free reader (`app/src/lib/xlsx.ts`)
that unzips the workbook via the built-in `DecompressionStream` and flattens the
first worksheet into CSV before it enters the same pipeline — no SheetJS/zip
dependency is added. Only text/number cells are read (styles/dates are out of
scope); if a workbook can't be read, the UI asks the user to export CSV.

---

## Pipeline

```
upload → Intake/Normalize → Resolve → Duplicate Sentry → Policy Preview → Compose → Preview
                                                                                   → approve
                                                                                   → Execute → Receipts
```

Every stage except the (deterministic) schedule validator is plain TypeScript
with unit tests. **No LLM in the money path.**

- **Intake/Normalize** — validate header + each row; reject missing recipient,
  invalid amount, unsupported `type`, malformed/`misplaced` schedule. Per-row
  errors, never a whole-file abort (unless unparseable).
- **Resolve** — `resolveDetailed()` per row; snapshot the resolved address +
  source. Execution runs against the snapshot; a `.qie` repoint can never
  silently swap the recipient. Unresolved rows are blocked.
- **Duplicate Sentry** — four checks (below), run **after** resolution.
- **Policy Preview** — advisory mirror of the on-chain `AgentPolicy`.
- **Compose** — group valid rows by rail; chunk `pay` rows for `batchPay`.
- **Execute** — idempotent (below).
- **Receipts** — each confirmed `pay` settlement writes via the existing
  `/receipts` flow, linking `jobId` + `rowIndex` + `txHash`.

---

## Idempotency keys

Two deterministic keys (`sdk/src/csv/keys.ts`):

```
intentKey  = keccak256(jobId, rowIndex)
             # stable across retries/crashes WITHIN a job

contentKey = keccak256(smartAccount, resolvedAddress, token,
                       amount, normalizedMemo, scheduleSpec)
             # stable across re-uploads + history; computed AFTER resolution
```

Normalization for `contentKey`: lower-cased addresses, whitespace-normalized
memo, amount canonicalized to QUSDC base units, empty `scheduleSpec` for one-off
rows. Because addresses are encoded canonically, two different inputs that
resolve to the same address collapse to the same `contentKey` automatically.

**Core rule:** the executor refuses to submit any intent whose `intentKey` is
already confirmed. That single gate (`selectExecutableRows`) makes a
partially-completed job safe to resume — re-running submits **zero** duplicate
ops.

### Why off-chain idempotency is mandatory (contract finding)

`contracts/src/payments/BatchPayments.sol` treats `batchId` as **event-only
metadata** — it is emitted in `BatchPaid` but **never stored or checked**. A
repeated `batchId` does **not** revert and does **not** no-op; it re-executes the
transfers. So a deterministic `batchId = keccak256(jobId, chunkIndex)` is useful
for event dedup/observability, but it is **not** a crash-safe guard. At-most-once
execution is enforced off-chain by the job table (confirmed `intentKey`s).

The optional, backward-compatible `batchId?` on `BatchPayParams` lets CSV chunks
use the deterministic id; all existing callers keep the legacy timestamp id.

---

## Duplicate detection (`sdk/src/csv/dedupe.ts`)

Runs after resolution. Four checks, all feeding the preview:

1. **Same-file** — identical `contentKey` more than once in the upload.
2. **Same recipient + amount** (memo differs) — same `(resolvedAddress, amount,
   type)` repeated.
3. **Resolution collision** — distinct inputs that resolve to the same address.
4. **History** — `contentKey` seen within `lookbackHours` (default 24, service
   config) across our pending/recent jobs. A best-effort secondary check matches
   `(recipient, amount)` against on-chain `ReceiptRegistry` receipts — receipts
   don't carry our `contentKey`, so that signal is weaker and clearly labeled.

**Rail-aware severity:** a duplicate `pay`/`subscription` is a potential
double-spend → **block** by default. A duplicate `request` is an annoyance →
**warn**, allowed.

**Defaults:** duplicates never execute automatically. A user job has a per-job
`allowDuplicateRows` (off by default) to proceed after explicit review.
**Autopilot jobs always block duplicates — no override** (we deliberately do not
encode duplicate policy on-chain).

---

## Policy preview vs. on-chain policy

`previewPolicyForRows` (`sdk/src/csv/policy.ts`) mirrors the on-chain policy:
recipient allow-listed? rail allowed? amount ≤ `maxPerTx`? within remaining
daily/weekly/total (accumulated across the job)? within `validAfter`/
`validUntil`? Rows are marked `valid` / `needs_review` / `blocked`.

This is a **fail-fast mirror for UX only.** The `AgentPolicyManager` re-enforces
every limit at `executeSession`, and the QIE bundler runs unsafe/no-trace, so the
real backstop is on-chain `executeSession` / `EntryPoint.handleOps`. If preview
and chain ever disagree, the chain wins. Hard violations block; daily/weekly
window concerns (which the chain may clear by execution time) only flag
`needs_review`.

For the **user** path there is no on-chain per-job aggregate cap (the user signs
directly), so the preview surfaces the **job total** prominently. For
**Autopilot**, the per-row `executeSession` calls are naturally bounded by the
policy caps, so the aggregate is already protected on-chain.

---

## Job state machine

Per-job status, with **per-row** status tracked independently (rows succeed/fail
independently):

```
parsing → resolved → deduped → policy_checked → previewed
        → awaiting_approval → executing → completed
                                        ↘ partially_completed (resumable)
                                        ↘ cancelled
```

Per-row status: `valid | needs_review | blocked | executing | confirmed |
failed`. `resume` reconciles `executing` rows by their userOp receipt and
re-runs the executor over rows whose `intentKey` is not yet confirmed.

---

## Execution paths — user vs. Autopilot

| | **User-driven** | **Autopilot-driven (CSV-to-Autopilot)** |
| --- | --- | --- |
| Who signs | The user's wallet, in the app | A service-custodied session key |
| Primitive | `batchPay()` (chunked, deterministic `batchId`), `requestPayment()`, `subscribe()` | `executeAutopilotPayment()` **per row** under `policyId` |
| Where it runs | The app (the service holds no user key) | The service keeper loop (`startCsvImportExecutor`) |
| Duplicates | blocked by default; `allowDuplicateRows` opt-in after review | **always blocked**, no override |
| Money caps | user is the authority; preview shows the job total | on-chain policy caps, enforced per row at `executeSession` |
| Completion signal | app reports results to `POST /csv-import/:jobId/confirm` | the executor confirms inline / via reconcile |

Autopilot executes **single payments only** (`executeAutopilotPayment` is a
single QUSDC transfer through `executeSession`); `request`/`subscription` rows in
an Autopilot job are blocked at preview with a clear reason. We deliberately do
**not** invent a batch-session contract method — per-row ops are independently
policy-capped, independently idempotent, and cleanly resumable.

### Assumption called out

The original endpoint list assumed the executor could sign the user path. It
can't — the user signs client-side — so a confirmation channel is required. We
added one additive endpoint, `POST /csv-import/:jobId/confirm`, in the same new
namespace. The app reports the `userOpHash` (and then `txHash`) per chunk/row;
the service marks those `intentKey`s confirmed (idempotently) and writes
receipts. A `resume` reconciles any row left `executing`.

---

## Endpoints

```
POST /csv-import                  create job; run pipeline through "previewed"
                                  body: { smartAccount, csvText | csvBase64,
                                          fileName?, source?, policyId?,
                                          allowDuplicateRows? }
GET  /csv-import/:jobId           job + intents + counts/totals (drives preview)
POST /csv-import/:jobId/approve   { allowDuplicateRows?, rowOverrides? } → executing
                                  (user path returns the deterministic plan)
POST /csv-import/:jobId/confirm   user-signed callback: { rowIndexes, userOpHash?,
                                  txHash?, receiptType? } → mark confirmed + receipts
POST /csv-import/:jobId/resume    idempotent re-run over unconfirmed rows
POST /csv-import/:jobId/cancel    cancel; confirmed rows stay confirmed
```

CSV is accepted inline as `csvText` or base64 as `csvBase64`. (Multipart
upload is not implemented; the app sends `csvText`.)

---

## Config (service)

| Env var | Default | Meaning |
| --- | --- | --- |
| `CSV_IMPORT_JOB_STORE_PATH` | `./data/csv-import-jobs.json` | Job store |
| `CSV_IMPORT_INTENT_STORE_PATH` | `./data/csv-import-intents.json` | Intent store |
| `CSV_IMPORT_EXECUTOR_ENABLED` | `true` | Run the Autopilot executor loop |
| `CSV_IMPORT_POLL_INTERVAL_MS` | `15000` | Executor poll interval |
| `CSV_IMPORT_LOOKBACK_HOURS` | `24` | Duplicate-history window |
| `CSV_IMPORT_BATCH_CHUNK_SIZE` | `100` | User-path batch chunk size (≤ 200 cap) |
| `CSV_IMPORT_MAX_ROWS` | `500` | Max rows per upload |
```
