import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

/**
 * Deterministic idempotency keys for Bulk Intent Import.
 *
 * `intentKey` is stable across retries/crashes WITHIN a job (job + row). The
 * executor refuses to submit any intent whose intentKey is already confirmed —
 * this is what makes a partially-completed job safe to resume.
 *
 * `contentKey` is stable across re-uploads AND history (computed AFTER
 * resolution). Duplicate detection runs on it. Because addresses are encoded
 * canonically, two different inputs that resolve to the same address collapse to
 * the same contentKey automatically (resolution-collision detection).
 */

/** keccak256(jobId, rowIndex) — stable across retries within a job. */
export function computeIntentKey(jobId: string, rowIndex: number): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string jobId, uint256 rowIndex"), [
      jobId,
      BigInt(rowIndex),
    ]),
  );
}

export interface ContentKeyInput {
  smartAccount: Address;
  resolvedAddress: Address;
  token: Address;
  /** Amount in QUSDC base units (6 decimals). */
  amount: bigint;
  /** Already whitespace-normalized memo (may be ""). */
  normalizedMemo: string;
  /** Canonical schedule string ("" for one-off rows). */
  scheduleSpec: string;
}

/**
 * keccak256(smartAccount, resolvedAddress, token, amount, normalizedMemo,
 * scheduleSpec). Addresses are lower-cased before encoding so casing never
 * splits an otherwise-identical intent.
 */
export function computeContentKey(input: ContentKeyInput): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address smartAccount, address resolvedAddress, address token, uint256 amount, string memo, string schedule",
      ),
      [
        lower(input.smartAccount),
        lower(input.resolvedAddress),
        lower(input.token),
        input.amount,
        input.normalizedMemo,
        input.scheduleSpec,
      ],
    ),
  );
}

/** Lower-case an address for canonical, casing-insensitive hashing. */
export function lowerAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}

function lower(address: Address): Address {
  // getAddress validates; we then lowercase for canonical encoding.
  return getAddress(address).toLowerCase() as Address;
}
