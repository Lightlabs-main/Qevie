/**
 * Protocol stats indexer — orchestration.
 *
 * One poll loop per service process (single-chain, fixed by CHAIN_ID). Each tick
 * scans a bounded block window that is already buried under
 * INDEXER_CONFIRMATION_BLOCKS confirmations, normalizes every relevant event,
 * attaches block timestamps, and upserts them (idempotent by id). The cursor
 * only advances over confirmed blocks, so a shallow reorg cannot strand it.
 *
 * The indexer is strictly additive: it reads chain logs and writes its own JSON
 * stores. It never touches payment execution, session keys, or the paymaster.
 * Disable instantly with INDEXER_ENABLED=false.
 */

import { createPublicClient, http } from "viem";
import type { Address } from "viem";
import type { QevieProtocolEvent, QevieProtocolEventType } from "@qevie/sdk";
import {
  CHAIN_ID,
  CONTRACTS,
  INDEXER_CONFIRMATION_BLOCKS,
  INDEXER_ENABLED,
  INDEXER_MAX_BLOCK_RANGE,
  INDEXER_POLL_INTERVAL_MS,
  RPC_URL,
} from "../config.js";
import type { AnyPublicClient, IndexerContext, RawConfirmedEvent } from "./event-types.js";
import { collectPolicyEvents } from "./policy-indexer.js";
import { collectPaymentEvents } from "./payment-indexer.js";
import { collectPaymasterEvents } from "./paymaster-indexer.js";
import { collectReceiptEvents, receiptsConfigured } from "./receipt-indexer.js";
import { domainsConfigured } from "./domain-indexer.js";
import { getResumeBlock, setCursor } from "./cursor.js";
import {
  lastIndexedBlockFromEvents,
  loadEvents,
  queryEvents,
  upsertEvents,
} from "./store.js";
import { aggregateMyStats, aggregateProtocolStats } from "./stats-aggregator.js";

function getContext(): IndexerContext {
  const client = createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
  return { client, contracts: CONTRACTS, chainId: CHAIN_ID };
}

/** Attach block timestamps (one getBlock per unique block) and finalize records. */
async function withTimestamps(
  ctx: IndexerContext,
  raw: RawConfirmedEvent[],
): Promise<QevieProtocolEvent[]> {
  const uniqueBlocks = [...new Set(raw.map((e) => e.blockNumber))];
  const tsByBlock = new Map<number, number>();
  for (const bn of uniqueBlocks) {
    try {
      const block = await ctx.client.getBlock({ blockNumber: BigInt(bn) });
      tsByBlock.set(bn, Number(block.timestamp));
    } catch {
      tsByBlock.set(bn, Math.floor(Date.now() / 1000));
    }
  }
  return raw.map((e) => ({ ...e, timestamp: tsByBlock.get(e.blockNumber) ?? Math.floor(Date.now() / 1000) }));
}

let indexing = false;

export async function runIndexerOnce(): Promise<void> {
  if (indexing) return;
  indexing = true;
  try {
    const ctx = getContext();
    const head = await ctx.client.getBlockNumber();
    const confirmations = BigInt(Math.max(0, INDEXER_CONFIRMATION_BLOCKS));
    if (head < confirmations) return;
    const safeHead = head - confirmations;

    const fromBlock = getResumeBlock(ctx.chainId);
    if (fromBlock > safeHead) return; // nothing newly final to index

    const toBlock =
      safeHead - fromBlock + 1n > INDEXER_MAX_BLOCK_RANGE
        ? fromBlock + INDEXER_MAX_BLOCK_RANGE - 1n
        : safeHead;

    const collected: RawConfirmedEvent[] = [];
    for (const collect of [
      collectPolicyEvents,
      collectPaymentEvents,
      collectPaymasterEvents,
      collectReceiptEvents,
    ]) {
      collected.push(...(await collect(ctx, fromBlock, toBlock)));
    }

    if (collected.length > 0) {
      const finalized = await withTimestamps(ctx, collected);
      const added = upsertEvents(finalized);
      if (added > 0) {
        console.log(
          `[indexer] chain ${ctx.chainId} blocks ${fromBlock}-${toBlock}: +${added} events`,
        );
      }
    }

    setCursor(ctx.chainId, toBlock, Math.floor(Date.now() / 1000));
  } catch (e) {
    // Leave the cursor unadvanced so the same range retries next tick.
    console.error("[indexer] tick error:", e);
  } finally {
    indexing = false;
  }
}

export function startIndexer(): void {
  if (!INDEXER_ENABLED) {
    console.log("[indexer] disabled (INDEXER_ENABLED=false)");
    return;
  }
  console.log(`[indexer] starting with poll interval ${INDEXER_POLL_INTERVAL_MS}ms`);
  void runIndexerOnce();
  setInterval(() => { void runIndexerOnce(); }, INDEXER_POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// API facade (read-only, single-chain = this process's CHAIN_ID)
// ---------------------------------------------------------------------------

export function getProtocolStatsResponse(): ReturnType<typeof aggregateProtocolStats> {
  const ctx = getContext();
  return aggregateProtocolStats(loadEvents(), {
    chainId: CHAIN_ID,
    receiptsConfigured: receiptsConfigured(ctx),
    domainsConfigured: domainsConfigured(),
    lastIndexedBlock: lastIndexedBlockFromEvents(CHAIN_ID),
    now: Math.floor(Date.now() / 1000),
  });
}

export function getMyStatsResponse(smartAccount: Address): ReturnType<typeof aggregateMyStats> {
  return aggregateMyStats(loadEvents(), smartAccount, {
    chainId: CHAIN_ID,
    now: Math.floor(Date.now() / 1000),
  });
}

export function getProtocolEventsResponse(
  limit: number,
  types?: QevieProtocolEventType[],
): { chainId: number; events: QevieProtocolEvent[] } {
  return {
    chainId: CHAIN_ID,
    events: queryEvents({
      chainId: CHAIN_ID,
      limit,
      ...(types !== undefined ? { types } : {}),
    }),
  };
}

export function getMyEventsResponse(
  smartAccount: Address,
  limit: number,
  types?: QevieProtocolEventType[],
): { chainId: number; events: QevieProtocolEvent[] } {
  return {
    chainId: CHAIN_ID,
    events: queryEvents({
      chainId: CHAIN_ID,
      smartAccount,
      limit,
      ...(types !== undefined ? { types } : {}),
    }),
  };
}

/** Whether this process's chain matches a requested chainId (no cross-chain bleed). */
export function servesChain(chainId: number): boolean {
  return chainId === CHAIN_ID;
}

export { CHAIN_ID as INDEXED_CHAIN_ID };
