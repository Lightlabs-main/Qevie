/**
 * Receipt indexer — ReceiptRegistry `ReceiptCreated` events.
 *
 * ReceiptRegistry is only deployed on some networks (e.g. mainnet has it,
 * testnet does not). When `contracts.receiptRegistry` is undefined this indexer
 * is a clean no-op and the aggregator reports receipts as "not configured on
 * this network" — never a fabricated zero presented as fact.
 */

import type { Address, Hex } from "viem";
import {
  RECEIPT_CREATED,
  type IndexerContext,
  type RawConfirmedEvent,
  eventId,
} from "./event-types.js";

/** Receipt metrics are only meaningful when the registry exists on this chain. */
export function receiptsConfigured(ctx: IndexerContext): boolean {
  return ctx.contracts.receiptRegistry !== undefined;
}

export async function collectReceiptEvents(
  ctx: IndexerContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawConfirmedEvent[]> {
  const registry = ctx.contracts.receiptRegistry;
  if (registry === undefined) return [];
  const out: RawConfirmedEvent[] = [];

  const logs = await ctx.client.getLogs({
    address: registry,
    event: RECEIPT_CREATED,
    fromBlock,
    toBlock,
  });
  for (const log of logs) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as {
      receiptId?: Hex;
      payer?: Address;
      payee?: Address;
      token?: Address;
      amount?: bigint;
      amountPrivate?: boolean;
      issuer?: Address;
    };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "RECEIPT_CREATED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.receiptId !== undefined ? { receiptId: args.receiptId } : {}),
      ...(args.payer !== undefined ? { smartAccount: args.payer } : {}),
      ...(args.token !== undefined ? { token: args.token } : {}),
      // amountPrivate receipts hide the amount on-chain; respect that here too.
      ...(args.amountPrivate !== true && args.amount !== undefined
        ? { amountQusdc: args.amount.toString() }
        : {}),
      // issuer lets the aggregator split agent-generated vs manual receipts.
      ...(args.issuer !== undefined ? { owner: args.issuer } : {}),
      ...(args.amountPrivate === true ? { reason: "private" } : {}),
    });
  }

  return out;
}
