/**
 * Protocol stats indexer — reorg-safe block cursor.
 *
 * Stores the last block that was indexed at confirmation depth, per chain. The
 * indexer only ever advances the cursor to a block already buried under
 * `INDEXER_CONFIRMATION_BLOCKS` confirmations, so a shallow reorg cannot strand
 * the cursor ahead of a vanished event. On a cold start (no cursor) it begins
 * at `INDEXER_START_BLOCK`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { INDEXER_CURSOR_STORE_PATH, INDEXER_START_BLOCK } from "../config.js";

interface CursorRecord {
  chainId: number;
  /** Last block fully indexed at confirmation depth (decimal string). */
  lastBlock: string;
  updatedAt: number;
}

function load(): CursorRecord[] {
  const path = INDEXER_CURSOR_STORE_PATH();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CursorRecord[];
  } catch {
    return [];
  }
}

function save(records: CursorRecord[]): void {
  const path = INDEXER_CURSOR_STORE_PATH();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(records, null, 2), { mode: 0o600 });
}

/** Next block to scan FROM for a chain (cursor + 1, or the configured start). */
export function getResumeBlock(chainId: number): bigint {
  const rec = load().find((r) => r.chainId === chainId);
  if (rec === undefined) return INDEXER_START_BLOCK;
  return BigInt(rec.lastBlock) + 1n;
}

/**
 * Last block the indexer has fully scanned for a chain (the cursor head), or
 * null before the first tick. This is the honest "last indexed block" for the
 * dashboard — it advances every tick whether or not the range held events,
 * unlike the last-event block which can lag far behind during a quiet backfill.
 */
export function getLastScannedBlock(chainId: number): number | null {
  const rec = load().find((r) => r.chainId === chainId);
  return rec === undefined ? null : Number(rec.lastBlock);
}

/** Persist the highest block indexed at confirmation depth for a chain. */
export function setCursor(chainId: number, lastBlock: bigint, nowSeconds: number): void {
  const records = load();
  const idx = records.findIndex((r) => r.chainId === chainId);
  const next: CursorRecord = { chainId, lastBlock: lastBlock.toString(), updatedAt: nowSeconds };
  if (idx === -1) records.push(next);
  else records[idx] = next;
  save(records);
}
