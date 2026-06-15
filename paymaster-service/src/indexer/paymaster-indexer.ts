/**
 * Paymaster indexer — QeviePaymaster gas-mode events.
 *
 * The deployed paymaster emits `ModeBSponsored` (sponsored onboarding op) and
 * `ModeACharge` (gas paid in QUSDC, carrying both the QUSDC pulled and the
 * native gas cost fronted). Those give a real sponsored/QUSDC-gas split plus
 * QUSDC recovered and native QIE fronted. Per-UserOp native-fallback and a
 * total-UserOps-routed counter are NOT emitted by the current contract, so the
 * aggregator marks them "not tracked" rather than inventing them.
 */

import type { Address } from "viem";
import {
  PAYMASTER_MODE_A,
  PAYMASTER_MODE_B,
  type IndexerContext,
  type RawConfirmedEvent,
  eventId,
} from "./event-types.js";

export async function collectPaymasterEvents(
  ctx: IndexerContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawConfirmedEvent[]> {
  const paymaster = ctx.contracts.paymaster;
  const out: RawConfirmedEvent[] = [];

  const sponsored = await ctx.client.getLogs({
    address: paymaster,
    event: PAYMASTER_MODE_B,
    fromBlock,
    toBlock,
  });
  for (const log of sponsored) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { account?: Address; gasCostWei?: bigint };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "PAYMASTER_SPONSORED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      gasMode: "SPONSORED_ONBOARDING",
      ...(args.account !== undefined ? { smartAccount: args.account } : {}),
      // gasCostWei (native QIE fronted) carried in reason for aggregation.
      ...(args.gasCostWei !== undefined ? { reason: `gasCostWei=${args.gasCostWei.toString()}` } : {}),
    });
  }

  const charged = await ctx.client.getLogs({
    address: paymaster,
    event: PAYMASTER_MODE_A,
    fromBlock,
    toBlock,
  });
  for (const log of charged) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { account?: Address; qusdcCharged?: bigint; gasCostWei?: bigint };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "QUSDC_GAS_CHARGED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      gasMode: "QUSDC_GAS",
      ...(args.account !== undefined ? { smartAccount: args.account } : {}),
      ...(args.qusdcCharged !== undefined ? { amountQusdc: args.qusdcCharged.toString() } : {}),
      ...(args.gasCostWei !== undefined ? { reason: `gasCostWei=${args.gasCostWei.toString()}` } : {}),
    });
  }

  return out;
}
