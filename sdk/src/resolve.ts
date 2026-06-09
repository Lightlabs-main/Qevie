import { type Address, isAddress, type PublicClient } from "viem";
import { USERNAME_REGISTRY_ABI } from "./abis.js";
import { resolveOwnerViaDomainInfo } from "./identity/qieDomains.js";
import type { QevieContracts } from "./contracts.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

/**
 * Resolve a recipient string to a checksummed Ethereum address.
 *
 * Resolution order:
 *   1. Raw 0x address — returned as-is after checksum validation.
 *   2. *.qie domain — resolved via QIE Domains on-chain registry.
 *   3. Bare name — resolved via qevie UsernameRegistry fallback.
 *
 * Returns null if the name cannot be resolved.
 */
export async function resolveRecipient(
  client: AnyPublicClient,
  contracts: Pick<QevieContracts, "usernameRegistry">,
  recipient: string,
  qieDomainsAddress?: Address,
): Promise<Address | null> {
  if (isAddress(recipient)) {
    return recipient as Address;
  }

  const lower = recipient.toLowerCase();

  // QIE domain resolution (name.qie): forward-resolve to the domain owner via
  // the registry's canonical domainInfo() method. A `.qie` that does not resolve
  // returns null (it is NOT silently downgraded to a username lookup).
  if (lower.endsWith(".qie")) {
    if (!qieDomainsAddress) return null;
    return resolveOwnerViaDomainInfo(client, qieDomainsAddress, lower);
  }

  const name = lower;
  try {
    const resolved = await client.readContract({
      address: contracts.usernameRegistry,
      abi: USERNAME_REGISTRY_ABI,
      functionName: "resolve",
      args: [name],
    }) as Address;
    if (resolved !== "0x0000000000000000000000000000000000000000") {
      return resolved;
    }
  } catch {
    // Registry unreachable.
  }

  return null;
}
