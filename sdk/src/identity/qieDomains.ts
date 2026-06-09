import { type Address, getAddress, type PublicClient } from "viem";
import { QIE_DOMAINS_ABI } from "../abis.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

/** Normalize a recipient string: trim and lowercase a `.qie` name. */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

/** True when `input` (case-insensitive, trimmed) ends with `.qie`. */
export function isQieDomain(input: string): boolean {
  return normalizeName(input).endsWith(".qie");
}

/** Strip the trailing `.qie` suffix, returning the bare label. */
export function stripQieSuffix(input: string): string {
  const lower = normalizeName(input);
  return lower.endsWith(".qie") ? lower.slice(0, -4) : lower;
}

/**
 * Reverse-resolve an address to its registered `.qie` domain via the registry's
 * `userDomain(address)`. Returns the full `name.qie` (lowercased) or null.
 *
 * This is the trustworthy direction on the known QIE Domains registry, so it
 * doubles as the verification primitive for forward results and link fallbacks.
 */
export async function reverseLookupQieDomain(
  client: AnyPublicClient,
  registry: Address,
  address: Address,
): Promise<string | null> {
  try {
    const domain = (await client.readContract({
      address: registry,
      abi: QIE_DOMAINS_ABI,
      functionName: "userDomain",
      args: [address],
    })) as string;
    const trimmed = domain.trim();
    if (trimmed === "") return null;
    const lower = trimmed.toLowerCase();
    return lower.endsWith(".qie") ? lower : `${lower}.qie`;
  } catch {
    return null;
  }
}

/** Confirm `address` owns `name.qie` according to the registry's reverse map. */
export async function verifyDomainOwnership(
  client: AnyPublicClient,
  registry: Address,
  name: string,
  address: Address,
): Promise<boolean> {
  const owned = await reverseLookupQieDomain(client, registry, address);
  if (owned === null) return false;
  return owned === normalizeName(name).replace(/\.qie$/, "") + ".qie";
}

/** Whether a `.qie` name currently exists in the registry. */
export async function qieDomainExists(
  client: AnyPublicClient,
  registry: Address,
  name: string,
): Promise<boolean> {
  try {
    return (await client.readContract({
      address: registry,
      abi: QIE_DOMAINS_ABI,
      functionName: "domainExist",
      args: [stripQieSuffix(name)],
    })) as boolean;
  } catch {
    return false;
  }
}

/** Checksum an address string, or null if invalid. */
export function tryChecksum(value: string): Address | null {
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}
