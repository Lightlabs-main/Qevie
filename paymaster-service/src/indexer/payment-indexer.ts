/**
 * Payment indexer — QUSDC volume + execution events.
 *
 * Volume model (deliberately non-overlapping, so nothing is double-counted):
 *   - Manual single send:  QevieSmartAccount `Executed` where target == QUSDC
 *                          and calldata is an ERC-20 `transfer` → PAYMENT_EXECUTED
 *   - Autopilot single:    QevieSmartAccount `SessionExecution` where target ==
 *                          QUSDC and calldata is a `transfer`   → SESSION_EXECUTED
 *   - Batch:               BatchPayments `BatchPaid`            → BATCH_EXECUTED
 *   - Request settled:     PaymentRequest `RequestPaid`         → REQUEST_SETTLED
 *   - Subscription charge: SubscriptionManager `Charged`        → SUBSCRIPTION_EXECUTED
 *
 * `Executed` fires for every account call, so volume is only attributed when the
 * target is the QUSDC token AND the calldata is a transfer — approvals, policy
 * creation, and contract-routed calls (batch/request via execute) are excluded,
 * and those rails are counted once via their own contract event instead.
 * SessionBatchExecution is counted as an execution but carries no amount, so it
 * never contributes guessed volume.
 *
 * NOTE: `Executed` / `SessionExecution` are emitted by every QevieSmartAccount
 * instance, so logs are fetched by event topic across all accounts (no `address`
 * filter) and then narrowed by target. This is the one unavoidable wide scan.
 */

import type { Address, Hex } from "viem";
import {
  BATCH_PAID,
  EXECUTED,
  REQUEST_PAID,
  SESSION_BATCH_EXECUTION,
  SESSION_EXECUTION,
  SUBSCRIPTION_CHARGED,
  type IndexerContext,
  type RawConfirmedEvent,
  decodeTransferAmount,
  eventId,
  isSameAddress,
} from "./event-types.js";

export async function collectPaymentEvents(
  ctx: IndexerContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawConfirmedEvent[]> {
  const out: RawConfirmedEvent[] = [];
  const qusdc = ctx.contracts.qusdc;

  // --- Manual single sends: Executed(target=QUSDC, transfer) ---
  const executed = await ctx.client.getLogs({ event: EXECUTED, fromBlock, toBlock });
  for (const log of executed) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { target?: Address; data?: Hex };
    if (!isSameAddress(args.target, qusdc) || args.data === undefined) continue;
    const amount = decodeTransferAmount(args.data);
    if (amount === null || amount === 0n) continue;
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "PAYMENT_EXECUTED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      // `Executed` is emitted by the QevieSmartAccount itself → its address is
      // the user's smart account, enabling per-wallet attribution.
      smartAccount: log.address,
      token: qusdc,
      amountQusdc: amount.toString(),
    });
  }

  // --- Autopilot session executions ---
  const sessions = await ctx.client.getLogs({ event: SESSION_EXECUTION, fromBlock, toBlock });
  for (const log of sessions) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { policyId?: Hex; sessionKey?: Address; target?: Address; data?: Hex };
    const amount = isSameAddress(args.target, qusdc) && args.data !== undefined
      ? decodeTransferAmount(args.data)
      : null;
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "SESSION_EXECUTED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      smartAccount: log.address,
      ...(args.policyId !== undefined ? { policyId: args.policyId } : {}),
      ...(args.sessionKey !== undefined ? { sessionKey: args.sessionKey } : {}),
      ...(amount !== null && amount > 0n
        ? { token: qusdc, amountQusdc: amount.toString() }
        : {}),
    });
  }

  // --- Autopilot batch executions (count only; no per-call amounts emitted) ---
  const batchSessions = await ctx.client.getLogs({ event: SESSION_BATCH_EXECUTION, fromBlock, toBlock });
  for (const log of batchSessions) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { policyId?: Hex; sessionKey?: Address; callCount?: bigint };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "SESSION_BATCH_EXECUTED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      smartAccount: log.address,
      ...(args.policyId !== undefined ? { policyId: args.policyId } : {}),
      ...(args.sessionKey !== undefined ? { sessionKey: args.sessionKey } : {}),
      ...(args.callCount !== undefined ? { reason: `callCount=${args.callCount.toString()}` } : {}),
    });
  }

  // --- Batch payments ---
  const batches = await ctx.client.getLogs({
    address: ctx.contracts.batchPayments,
    event: BATCH_PAID,
    fromBlock,
    toBlock,
  });
  for (const log of batches) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { sender?: Address; amounts?: readonly bigint[] };
    const total = (args.amounts ?? []).reduce((sum, a) => sum + a, 0n);
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "BATCH_EXECUTED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.sender !== undefined ? { smartAccount: args.sender } : {}),
      token: qusdc,
      amountQusdc: total.toString(),
    });
  }

  // --- Payment requests settled ---
  const requests = await ctx.client.getLogs({
    address: ctx.contracts.paymentRequest,
    event: REQUEST_PAID,
    fromBlock,
    toBlock,
  });
  for (const log of requests) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { payer?: Address; amount?: bigint };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "REQUEST_SETTLED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.payer !== undefined ? { smartAccount: args.payer } : {}),
      token: qusdc,
      ...(args.amount !== undefined ? { amountQusdc: args.amount.toString() } : {}),
    });
  }

  // --- Subscription charges (executed charges only, never future schedule) ---
  const charges = await ctx.client.getLogs({
    address: ctx.contracts.subscriptionManager,
    event: SUBSCRIPTION_CHARGED,
    fromBlock,
    toBlock,
  });
  for (const log of charges) {
    if (log.transactionHash === null || log.logIndex === null) continue;
    const args = log.args as { payer?: Address; payee?: Address; amount?: bigint };
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "SUBSCRIPTION_EXECUTED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.payer !== undefined ? { smartAccount: args.payer } : {}),
      token: qusdc,
      ...(args.amount !== undefined ? { amountQusdc: args.amount.toString() } : {}),
    });
  }

  return out;
}
