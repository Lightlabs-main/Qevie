/**
 * Allowlist token service: issues signed tokens for Mode B (sponsored) tier.
 *
 * Gating hierarchy (in order):
 *   1. QIE Domain ownership (verified via on-chain registry).
 *   2. Manual allowlist (operator-managed, for testing/early users).
 *
 * Token format: { expiry: uint32, signature: hex65 }
 * Signed data: keccak256(abi.encode(smartAccountAddress, expiry, chainId))
 */

import {
  type Address,
  type Hex,
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { QIE_DOMAINS_ABI } from "@qevie/sdk";
import { CHAIN_ID, RPC_URL, QIE_DOMAINS_ADDRESS, SIGNER_PRIVATE_KEY } from "./config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = ReturnType<typeof createPublicClient<any, any, any>>;

const EXPIRY_WINDOW_SECONDS = 3600 * 24; // 24 hours

let publicClientCache: AnyPublicClient | null = null;

function getPublicClient(): AnyPublicClient {
  if (publicClientCache === null) {
    publicClientCache = createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
  }
  return publicClientCache;
}

/** Return true if the given address owns a .qie domain. */
async function hasQIEDomain(address: Address): Promise<boolean> {
  try {
    const result = await getPublicClient().readContract({
      address: QIE_DOMAINS_ADDRESS,
      abi: QIE_DOMAINS_ABI,
      functionName: "userDomain",
      args: [address],
    }) as string;
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Manual operator allowlist (loaded from env or config). */
const MANUAL_ALLOWLIST: Set<string> = new Set(
  (process.env["MANUAL_ALLOWLIST"] ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
);

/** Issue an allowlist token for a smart account address. Returns null if gating fails. */
export async function issueAllowlistToken(
  smartAccountAddress: Address,
): Promise<{ expiry: number; signature: Hex } | null> {
  const lower = smartAccountAddress.toLowerCase();

  const allowed =
    MANUAL_ALLOWLIST.has(lower) || (await hasQIEDomain(smartAccountAddress));

  if (!allowed) return null;

  const expiry = Math.floor(Date.now() / 1000) + EXPIRY_WINDOW_SECONDS;

  // Sign: keccak256(abi.encode(address, uint32 expiry, uint256 chainId))
  const digest = keccak256(
    encodeAbiParameters(parseAbiParameters("address, uint32, uint256"), [
      smartAccountAddress,
      expiry,
      BigInt(CHAIN_ID),
    ]),
  );

  const key = SIGNER_PRIVATE_KEY();
  const account = privateKeyToAccount(key as Hex);
  const signature = await account.signMessage({ message: { raw: digest } });

  return { expiry, signature };
}
