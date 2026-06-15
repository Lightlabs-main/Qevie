/**
 * Protocol stats indexer — persistence.
 *
 * JSON-file store mirroring the Autopilot/CSV-import store pattern: whole-array
 * load/save with mode 0o600. Events are deduped by their stable `id`
 * (`chainId:txHash:logIndex`), so re-scanning an already-indexed range is
 * idempotent. The store is bounded to `PROTOCOL_EVENTS_MAX` newest events to
 * keep the file small; aggregate counters are computed from the retained window
 * (sufficient for a live dashboard, not a historical ledger).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import type { QevieProtocolEvent, QevieProtocolEventType } from "@qevie/sdk";
import { PROTOCOL_EVENTS_MAX, PROTOCOL_EVENTS_STORE_PATH } from "../config.js";

function load(path: string): QevieProtocolEvent[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as QevieProtocolEvent[];
  } catch {
    return [];
  }
}

function save(path: string, items: QevieProtocolEvent[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(items, null, 2), { mode: 0o600 });
}

export function loadEvents(): QevieProtocolEvent[] {
  return load(PROTOCOL_EVENTS_STORE_PATH());
}

/**
 * Merge newly-indexed events into the store, deduped by `id`. Newer data for an
 * existing id (e.g. a pending event flipping to confirmed) overwrites the old
 * record. Returns the number of genuinely new ids added.
 */
export function upsertEvents(incoming: QevieProtocolEvent[]): number {
  if (incoming.length === 0) return 0;
  const existing = loadEvents();
  const byId = new Map<string, QevieProtocolEvent>();
  for (const e of existing) byId.set(e.id, e);
  let added = 0;
  for (const e of incoming) {
    if (!byId.has(e.id)) added += 1;
    byId.set(e.id, e);
  }
  const merged = [...byId.values()].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return (a.blockNumber ?? 0) - (b.blockNumber ?? 0);
  });
  // Keep the newest PROTOCOL_EVENTS_MAX.
  const bounded = merged.slice(Math.max(0, merged.length - PROTOCOL_EVENTS_MAX));
  save(PROTOCOL_EVENTS_STORE_PATH(), bounded);
  return added;
}

export interface EventQuery {
  chainId: number;
  types?: QevieProtocolEventType[];
  smartAccount?: Address;
  /** Only events with timestamp >= sinceSeconds. */
  sinceSeconds?: number;
  limit?: number;
}

/** Query the store, newest first. Always filtered by chainId (no cross-chain bleed). */
export function queryEvents(q: EventQuery): QevieProtocolEvent[] {
  const wantTypes = q.types !== undefined && q.types.length > 0 ? new Set(q.types) : null;
  const acct = q.smartAccount?.toLowerCase();
  let rows = loadEvents().filter((e) => {
    if (e.chainId !== q.chainId) return false;
    if (wantTypes !== null && !wantTypes.has(e.type)) return false;
    if (q.sinceSeconds !== undefined && e.timestamp < q.sinceSeconds) return false;
    if (acct !== undefined) {
      const owner = e.owner?.toLowerCase();
      const sa = e.smartAccount?.toLowerCase();
      if (sa !== acct && owner !== acct) return false;
    }
    return true;
  });
  rows = rows.sort((a, b) => b.timestamp - a.timestamp);
  if (q.limit !== undefined) rows = rows.slice(0, q.limit);
  return rows;
}

/** Highest indexed block number seen for a chain, or null if none. */
export function lastIndexedBlockFromEvents(chainId: number): number | null {
  let max: number | null = null;
  for (const e of loadEvents()) {
    if (e.chainId !== chainId) continue;
    if (e.blockNumber !== undefined && (max === null || e.blockNumber > max)) {
      max = e.blockNumber;
    }
  }
  return max;
}

export type { QevieProtocolEvent, Hex };
