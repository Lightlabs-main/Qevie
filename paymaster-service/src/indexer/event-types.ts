/**
 * Protocol stats indexer — shared event ABIs, context, and helpers.
 *
 * The normalized event/stat types live in `@qevie/sdk` (single source of truth
 * shared with the read client). This module holds the on-chain event signatures
 * the indexer scans for, plus small helpers to turn a viem log into a confirmed
 * `QevieProtocolEvent`. Only events that already exist on the deployed contracts
 * are listed here — nothing is invented.
 */

import { type AbiEvent, parseAbiItem } from "viem";
import type { QevieContracts, QevieProtocolEvent } from "@qevie/sdk";
import type { Address, Hex, PublicClient } from "viem";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPublicClient = PublicClient<any, any, any>;

export interface IndexerContext {
  client: AnyPublicClient;
  contracts: QevieContracts;
  chainId: number;
}

/**
 * A confirmed event awaiting a block timestamp. The source indexers set the
 * stable `id`; the indexer core attaches the block timestamp (one getBlock per
 * unique block) to finalize it into a `QevieProtocolEvent`.
 */
export type RawConfirmedEvent = Omit<QevieProtocolEvent, "timestamp"> & {
  status: "confirmed";
  txHash: Hex;
  blockNumber: number;
  logIndex: number;
};

/** Stable dedupe id for a confirmed on-chain event. */
export function eventId(chainId: number, txHash: Hex, logIndex: number): string {
  return `${chainId}:${txHash}:${logIndex}`;
}

/** ERC-20 `transfer(address,uint256)` selector — used to classify single sends. */
export const TRANSFER_SELECTOR = "0xa9059cbb";

/** Decode the amount from an ERC-20 `transfer` calldata, or null if not a transfer. */
export function decodeTransferAmount(data: Hex): bigint | null {
  if (!data.startsWith(TRANSFER_SELECTOR)) return null;
  // selector(4) + to(32) + amount(32) = 0x + 8 + 64 + 64 hex chars.
  if (data.length < 2 + 8 + 64 + 64) return null;
  const amountHex = data.slice(2 + 8 + 64, 2 + 8 + 64 + 64);
  try {
    return BigInt(`0x${amountHex}`);
  } catch {
    return null;
  }
}

export function isSameAddress(a: Address | undefined, b: Address | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

// ---------------------------------------------------------------------------
// On-chain event signatures (must match the deployed contracts exactly)
// ---------------------------------------------------------------------------

export const AGENT_POLICY_CREATED: AbiEvent = parseAbiItem(
  "event AgentPolicyCreated(bytes32 indexed policyId, address indexed smartAccount, address indexed sessionKey, address guardian, address token, uint64 validUntil)",
);
export const AGENT_POLICY_REVOKED: AbiEvent = parseAbiItem(
  "event AgentPolicyRevoked(bytes32 indexed policyId, address indexed smartAccount)",
);
export const AGENT_POLICY_GUARDIAN_REVOKED: AbiEvent = parseAbiItem(
  "event AgentPolicyGuardianRevoked(bytes32 indexed policyId, address indexed guardian, string reason)",
);

export const SESSION_EXECUTION: AbiEvent = parseAbiItem(
  "event SessionExecution(bytes32 indexed policyId, address indexed sessionKey, address indexed target, uint256 value, bytes data)",
);
export const SESSION_BATCH_EXECUTION: AbiEvent = parseAbiItem(
  "event SessionBatchExecution(bytes32 indexed policyId, address indexed sessionKey, uint256 callCount)",
);
export const EXECUTED: AbiEvent = parseAbiItem(
  "event Executed(address indexed target, uint256 value, bytes data, bytes result)",
);

export const BATCH_PAID: AbiEvent = parseAbiItem(
  "event BatchPaid(address indexed sender, address[] recipients, uint256[] amounts, bytes32 indexed batchId)",
);
export const REQUEST_PAID: AbiEvent = parseAbiItem(
  "event RequestPaid(uint256 indexed requestId, address indexed payer, uint256 amount)",
);
export const SUBSCRIPTION_CHARGED: AbiEvent = parseAbiItem(
  "event Charged(uint256 indexed subId, address indexed payer, address indexed payee, uint256 amount, uint256 paymentNumber)",
);

export const PAYMASTER_MODE_A: AbiEvent = parseAbiItem(
  "event ModeACharge(address indexed account, uint256 qusdcCharged, uint256 gasCostWei)",
);
export const PAYMASTER_MODE_B: AbiEvent = parseAbiItem(
  "event ModeBSponsored(address indexed account, uint256 gasCostWei, uint256 remainingOps)",
);

export const RECEIPT_CREATED: AbiEvent = parseAbiItem(
  "event ReceiptCreated(bytes32 indexed receiptId, address indexed payer, address indexed payee, address token, uint256 amount, bool amountPrivate, bytes32 metadataHash, bytes32 paymentReference, uint8 receiptType, address issuer, uint64 timestamp)",
);
