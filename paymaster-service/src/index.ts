/**
 * qevie paymaster-service
 *
 * Provides:
 *   POST /allowlist-token     Issue a Mode B sponsorship token (Sybil-gated)
 *   POST /session-key         Provision a server-custodied Autopilot session key
 *   POST /autopilot/intent    Schedule an Autopilot payment intent
 *   GET  /autopilot/intents   List Autopilot intents for a smart account
 *   POST /autopilot/cancel    Cancel a scheduled Autopilot intent
 *   GET  /health              Health check
 *
 * Also runs the subscription keeper and Autopilot executor loops.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type Address, type Hex, isAddress } from "viem";
import { issueAllowlistToken } from "./allowlist.js";
import { startKeeper } from "./keeper.js";
import { startDexHeartbeat } from "./dex-heartbeat.js";
import { startRebalancer } from "./rebalancer.js";
import { PORT } from "./config.js";
import { issueReceipt } from "./receipts.js";
import { provisionSessionKey } from "./session-keys.js";
import { createValidatedIntent, startAutopilotExecutor } from "./autopilot-executor.js";
import { cancelIntent, listIntents } from "./autopilot-intents.js";
import { resolveRecipientForPreview } from "./identity/resolve-recipient.js";
import {
  approveJob,
  cancelJob,
  confirmUserRows,
  createJob,
  getJobView,
  resumeJob,
  startCsvImportExecutor,
} from "./csv-import.js";

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() });
  res.end(body);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.url === "/health" && req.method === "GET") {
    json(res, 200, { ok: true, service: "qevie-paymaster-service" });
    return;
  }

  if (req.url === "/allowlist-token" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { address?: string };
      if (typeof body.address !== "string") {
        json(res, 400, { error: "address required" });
        return;
      }
      const token = await issueAllowlistToken(body.address as `0x${string}`);
      if (token === null) {
        json(res, 403, { error: "Not eligible for sponsored tier. Own a .qie domain or contact support." });
        return;
      }
      json(res, 200, token);
    } catch (e) {
      console.error("[api] /allowlist-token error:", e);
      json(res, 500, { error: "Internal error" });
    }
    return;
  }

  if (req.url === "/session-key" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { smartAccount?: string };
      if (typeof body.smartAccount !== "string" || !isAddress(body.smartAccount)) {
        json(res, 400, { error: "valid smartAccount address required" });
        return;
      }
      const sessionKey = provisionSessionKey(body.smartAccount);
      json(res, 200, { sessionKey });
    } catch (e) {
      // Most likely cause: SESSION_KEY_ENC_SECRET is not configured.
      console.error("[api] /session-key error:", e);
      const message = e instanceof Error && /SESSION_KEY_ENC_SECRET/.test(e.message)
        ? "Session key service is not configured on this deployment."
        : "Internal error";
      json(res, 503, { error: message });
    }
    return;
  }

  if (req.url === "/autopilot/intent" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as {
        smartAccount?: string;
        policyId?: string;
        recipient?: string;
        amount?: string;
        intervalSeconds?: number | null;
        maxRuns?: number;
        startAt?: number;
      };
      if (
        typeof body.smartAccount !== "string" || !isAddress(body.smartAccount) ||
        typeof body.recipient !== "string" || !isAddress(body.recipient) ||
        typeof body.policyId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.policyId) ||
        typeof body.amount !== "string" || !/^\d+$/.test(body.amount)
      ) {
        json(res, 400, { error: "smartAccount, policyId, recipient and amount (base units) are required" });
        return;
      }
      const interval = typeof body.intervalSeconds === "number" && body.intervalSeconds > 0
        ? Math.floor(body.intervalSeconds)
        : null;
      const maxRuns = typeof body.maxRuns === "number" && body.maxRuns >= 1
        ? Math.floor(body.maxRuns)
        : 1;
      const startAt = typeof body.startAt === "number" && body.startAt > 0
        ? Math.floor(body.startAt)
        : Math.floor(Date.now() / 1000);

      const intent = await createValidatedIntent({
        smartAccount: body.smartAccount as Address,
        policyId: body.policyId as Hex,
        recipient: body.recipient as Address,
        amount: BigInt(body.amount),
        intervalSeconds: interval,
        maxRuns,
        startAt,
      });
      json(res, 200, { intent });
    } catch (e) {
      // createValidatedIntent throws user-facing policy errors → 400.
      console.error("[api] /autopilot/intent error:", e);
      json(res, 400, { error: e instanceof Error ? e.message : "Could not schedule payment." });
    }
    return;
  }

  if (req.url?.startsWith("/autopilot/intents") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const smartAccount = url.searchParams.get("smartAccount");
    if (smartAccount === null || !isAddress(smartAccount)) {
      json(res, 400, { error: "valid smartAccount query param required" });
      return;
    }
    json(res, 200, { intents: listIntents(smartAccount as Address) });
    return;
  }

  if (req.url === "/autopilot/cancel" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { id?: string; smartAccount?: string };
      if (
        typeof body.id !== "string" ||
        typeof body.smartAccount !== "string" || !isAddress(body.smartAccount)
      ) {
        json(res, 400, { error: "id and smartAccount required" });
        return;
      }
      const found = cancelIntent(body.id, body.smartAccount as Address);
      if (!found) {
        json(res, 404, { error: "Intent not found for this account." });
        return;
      }
      json(res, 200, { ok: true });
    } catch (e) {
      console.error("[api] /autopilot/cancel error:", e);
      json(res, 500, { error: "Internal error" });
    }
    return;
  }

  // Recipient resolution PREVIEW (incl. .qie). This is preview-only: the
  // Autopilot executor always pays the address locked on the policy/intent and
  // never re-resolves a domain to override it.
  if (req.url === "/resolve-recipient" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { recipient?: string };
      if (typeof body.recipient !== "string" || body.recipient.trim() === "") {
        json(res, 400, { error: "recipient required" });
        return;
      }
      const result = await resolveRecipientForPreview(body.recipient);
      json(res, 200, result);
    } catch (e) {
      console.error("[api] /resolve-recipient error:", e);
      json(res, 500, { error: "Internal error" });
    }
    return;
  }

  if (req.url === "/receipts" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as {
        payer?: string;
        payee?: string;
        token?: string;
        amount?: string;
        amountPrivate?: boolean;
        metadataHash?: `0x${string}`;
        receiptType?: string;
        paymentReference?: `0x${string}`;
      };
      if (
        typeof body.payer !== "string" ||
        typeof body.payee !== "string" ||
        typeof body.token !== "string" ||
        typeof body.amount !== "string" ||
        typeof body.amountPrivate !== "boolean" ||
        typeof body.metadataHash !== "string" ||
        typeof body.receiptType !== "string"
      ) {
        json(res, 400, { error: "invalid receipt request" });
        return;
      }

      const receipt = await issueReceipt({
        payer: body.payer as `0x${string}`,
        payee: body.payee as `0x${string}`,
        token: body.token as `0x${string}`,
        amount: body.amount,
        amountPrivate: body.amountPrivate,
        metadataHash: body.metadataHash,
        receiptType: body.receiptType as never,
        paymentReference: body.paymentReference,
      });
      json(res, 200, receipt);
    } catch (e) {
      console.error("[api] /receipts error:", e);
      json(res, 500, { error: e instanceof Error ? e.message : "Internal error" });
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Bulk Intent Import (CSV → policy-checked QUSDC execution)
  // -------------------------------------------------------------------------
  if (req.url?.startsWith("/csv-import")) {
    try {
      await handleCsvImport(req, res);
    } catch (e) {
      console.error("[api] /csv-import error:", e);
      json(res, 400, { error: e instanceof Error ? e.message : "Bulk import error." });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

/**
 * Router for the Bulk Intent Import endpoints. Follows the existing bare-http
 * conventions (JSON in/out, CORS already set, no auth layer — `uploadedBy` is
 * informational). Accepts the CSV inline as `csvText`, or base64 as `csvBase64`.
 */
async function handleCsvImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const parts = url.pathname.split("/").filter((p) => p !== ""); // ["csv-import", jobId?, action?]
  const jobId = parts[1];
  const action = parts[2];

  // POST /csv-import — create a job and run the pipeline through "previewed".
  if (jobId === undefined && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      fileName?: string;
      csvText?: string;
      csvBase64?: string;
      smartAccount?: string;
      uploadedBy?: string;
      source?: string;
      policyId?: string;
      allowDuplicateRows?: boolean;
    };
    if (typeof body.smartAccount !== "string" || !isAddress(body.smartAccount)) {
      json(res, 400, { error: "valid smartAccount address required" });
      return;
    }
    const csvText =
      typeof body.csvText === "string"
        ? body.csvText
        : typeof body.csvBase64 === "string"
          ? Buffer.from(body.csvBase64, "base64").toString("utf8")
          : undefined;
    if (csvText === undefined || csvText.trim() === "") {
      json(res, 400, { error: "csvText or csvBase64 required" });
      return;
    }
    const source = body.source === "autopilot" ? "autopilot" : "user";
    if (source === "autopilot" && (typeof body.policyId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.policyId))) {
      json(res, 400, { error: "policyId is required for an Autopilot import" });
      return;
    }
    const job = await createJob({
      fileName: typeof body.fileName === "string" ? body.fileName : "import.csv",
      csvText,
      smartAccount: body.smartAccount as Address,
      source,
      allowDuplicateRows: body.allowDuplicateRows === true,
      ...(typeof body.uploadedBy === "string" && isAddress(body.uploadedBy)
        ? { uploadedBy: body.uploadedBy as Address }
        : {}),
      ...(source === "autopilot" ? { policyId: body.policyId as Hex } : {}),
    });
    const view = getJobView(job.jobId);
    json(res, 200, view);
    return;
  }

  if (typeof jobId !== "string") {
    json(res, 404, { error: "Not found" });
    return;
  }

  // GET /csv-import/:jobId
  if (action === undefined && req.method === "GET") {
    const view = getJobView(jobId);
    if (view === undefined) {
      json(res, 404, { error: "Job not found." });
      return;
    }
    json(res, 200, view);
    return;
  }

  if (req.method !== "POST") {
    json(res, 404, { error: "Not found" });
    return;
  }

  // POST /csv-import/:jobId/approve
  if (action === "approve") {
    const body = JSON.parse((await readBody(req)) || "{}") as {
      allowDuplicateRows?: boolean;
      rowOverrides?: Array<{ rowIndex: number; action: "remove" | "keep" }>;
    };
    const result = approveJob(jobId, {
      ...(typeof body.allowDuplicateRows === "boolean" ? { allowDuplicateRows: body.allowDuplicateRows } : {}),
      ...(Array.isArray(body.rowOverrides) ? { rowOverrides: body.rowOverrides } : {}),
    });
    json(res, 200, result);
    return;
  }

  // POST /csv-import/:jobId/confirm — user-signed execution callback.
  if (action === "confirm") {
    const body = JSON.parse((await readBody(req)) || "{}") as {
      rowIndexes?: number[];
      userOpHash?: string;
      txHash?: string;
      receiptType?: "BATCH_PAYMENT" | "SINGLE_PAYMENT" | "PAYMENT_REQUEST_SETTLED" | "SUBSCRIPTION_PAYMENT";
    };
    if (!Array.isArray(body.rowIndexes) || body.rowIndexes.length === 0) {
      json(res, 400, { error: "rowIndexes required" });
      return;
    }
    const job = await confirmUserRows(jobId, {
      rowIndexes: body.rowIndexes,
      ...(typeof body.userOpHash === "string" ? { userOpHash: body.userOpHash as Hex } : {}),
      ...(typeof body.txHash === "string" ? { txHash: body.txHash as Hex } : {}),
      ...(body.receiptType !== undefined ? { receiptType: body.receiptType } : {}),
    });
    json(res, 200, { job });
    return;
  }

  // POST /csv-import/:jobId/resume
  if (action === "resume") {
    const result = await resumeJob(jobId);
    json(res, 200, result);
    return;
  }

  // POST /csv-import/:jobId/cancel
  if (action === "cancel") {
    json(res, 200, { job: cancelJob(jobId) });
    return;
  }

  json(res, 404, { error: "Not found" });
}

server.listen(PORT, () => {
  console.log(`[paymaster-service] listening on :${PORT}`);
});

// A single failing background tx (e.g. a signer momentarily out of native QIE)
// must never take the whole service down. Log and keep the loops running; the
// rebalancer/operator restores funds on the next tick.
process.on("unhandledRejection", (reason) => {
  console.error("[service] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[service] uncaughtException:", err);
});

startKeeper();
startAutopilotExecutor();
startCsvImportExecutor();
startDexHeartbeat();
startRebalancer();

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
