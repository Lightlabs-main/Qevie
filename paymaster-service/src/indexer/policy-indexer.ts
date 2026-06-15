/**
 * Policy indexer — AgentPolicyManager events.
 *
 * Emits POLICY_CREATED (with `validUntil` carried in `reason` for expiry
 * computation downstream), POLICY_REVOKED, and GUARDIAN_REVOKED (the only real
 * guardian-veto signal the contract emits). Guardian *approvals* and on-chain
 * pause are not emitted by the current contract, so they are never produced
 * here — the aggregator marks them as "not tracked" rather than faking a count.
 */

import type { Address, Hex } from "viem";
import {
  AGENT_POLICY_CREATED,
  AGENT_POLICY_GUARDIAN_REVOKED,
  AGENT_POLICY_REVOKED,
  type IndexerContext,
  type RawConfirmedEvent,
  eventId,
} from "./event-types.js";

export async function collectPolicyEvents(
  ctx: IndexerContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawConfirmedEvent[]> {
  const manager = ctx.contracts.agentPolicyManager;
  if (manager === undefined) return [];
  const out: RawConfirmedEvent[] = [];

  const created = await ctx.client.getLogs({
    address: manager,
    event: AGENT_POLICY_CREATED,
    fromBlock,
    toBlock,
  });
  for (const log of created) {
    const args = log.args as {
      policyId?: Hex;
      smartAccount?: Address;
      sessionKey?: Address;
      token?: Address;
      validUntil?: bigint;
    };
    if (log.transactionHash === null || log.logIndex === null) continue;
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "POLICY_CREATED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.smartAccount !== undefined ? { smartAccount: args.smartAccount } : {}),
      ...(args.policyId !== undefined ? { policyId: args.policyId } : {}),
      ...(args.sessionKey !== undefined ? { sessionKey: args.sessionKey } : {}),
      ...(args.token !== undefined ? { token: args.token } : {}),
      // validUntil drives active/expired classification in the aggregator.
      ...(args.validUntil !== undefined ? { reason: `validUntil=${args.validUntil.toString()}` } : {}),
    });
  }

  const revoked = await ctx.client.getLogs({
    address: manager,
    event: AGENT_POLICY_REVOKED,
    fromBlock,
    toBlock,
  });
  for (const log of revoked) {
    const args = log.args as { policyId?: Hex; smartAccount?: Address };
    if (log.transactionHash === null || log.logIndex === null) continue;
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "POLICY_REVOKED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.smartAccount !== undefined ? { smartAccount: args.smartAccount } : {}),
      ...(args.policyId !== undefined ? { policyId: args.policyId } : {}),
    });
  }

  const guardianRevoked = await ctx.client.getLogs({
    address: manager,
    event: AGENT_POLICY_GUARDIAN_REVOKED,
    fromBlock,
    toBlock,
  });
  for (const log of guardianRevoked) {
    const args = log.args as { policyId?: Hex; guardian?: Address; reason?: string };
    if (log.transactionHash === null || log.logIndex === null) continue;
    out.push({
      id: eventId(ctx.chainId, log.transactionHash, log.logIndex),
      chainId: ctx.chainId,
      type: "GUARDIAN_REVOKED",
      status: "confirmed",
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      ...(args.policyId !== undefined ? { policyId: args.policyId } : {}),
      ...(args.reason !== undefined && args.reason !== "" ? { reason: args.reason } : {}),
    });
  }

  return out;
}
