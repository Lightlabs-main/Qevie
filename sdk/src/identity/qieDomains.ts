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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Forward-resolve a fully-qualified `.qie` name to its owner address via the QIE
 * Domains registry's `domainInfo(fqn)`. This is the canonical forward method
 * (verified against the QIE Domains app bundle + live registry); a name that is
 * not registered returns the zero address, which we surface as null.
 *
 * `name` may be bare ("alice") or full ("alice.qie"); it is normalized to the
 * fully-qualified form the registry expects.
 */
export async function resolveOwnerViaDomainInfo(
  client: AnyPublicClient,
  registry: Address,
  name: string,
): Promise<Address | null> {
  const fqn = `${stripQieSuffix(name)}.qie`;
  try {
    const info = (await client.readContract({
      address: registry,
      abi: QIE_DOMAINS_ABI,
      functionName: "domainInfo",
      args: [fqn],
    })) as { owner: Address };
    if (info.owner === undefined || info.owner.toLowerCase() === ZERO_ADDRESS) {
      return null;
    }
    return getAddress(info.owner);
  } catch {
    return null;
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
