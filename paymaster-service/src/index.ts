/**
 * qevie paymaster-service
 *
 * Provides:
 *   POST /allowlist-token    Issue a Mode B sponsorship token (Sybil-gated)
 *   POST /session-key        Provision a server-custodied Autopilot session key
 *   GET  /health             Health check
 *
 * Also runs the subscription keeper loop.
 */

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { isAddress } from "viem";
import { issueAllowlistToken } from "./allowlist.js";
import { startKeeper } from "./keeper.js";
import { PORT } from "./config.js";
import { issueReceipt } from "./receipts.js";
import { provisionSessionKey } from "./session-keys.js";

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

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[paymaster-service] listening on :${PORT}`);
});

startKeeper();

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
