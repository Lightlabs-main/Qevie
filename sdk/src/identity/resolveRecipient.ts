import { type Address, isAddress, getAddress, type PublicClient } from "viem";
import { USERNAME_REGISTRY_ABI } from "../abis.js";
import type { QevieContracts } from "../contracts.js";
import type {
  QieDomainConfig,
  QieDomainResolverAdapter,
  ResolveRecipientResult,
} from "./types.js";
import { createResolverAdapter } from "./resolverAdapter.js";
import {
  isQieDomain,
  normalizeName,
  reverseLookupQieDomain,
  stripQieSuffix,
} from "./qieDomains.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

const ZERO = "0x0000000000000000000000000000000000000000";

export interface ResolveRecipientDeps {
  client: AnyPublicClient;
  contracts: Pick<QevieContracts, "usernameRegistry">;
  domainConfig?: QieDomainConfig;
  /** Pre-built adapter (optional). Built from `domainConfig` when omitted. */
  adapter?: QieDomainResolverAdapter;
  /** Wall-clock ms; injectable for deterministic tests. */
  now?: () => number;
}

/**
 * Resolve a recipient string into a typed, source-tagged result.
 *
 * Resolution order:
 *   1. `0x…` address — checksum-validated, source `direct_address`.
 *   2. `name.qie` — forward via the configured QIE Domain resolver, then
 *      reverse-VERIFIED against the registry's `userDomain`. With no forward
 *      resolver configured this is cleanly unavailable (no fabrication).
 *   3. bare name — Qevie `UsernameRegistry.resolve` fallback.
 *
 * Never throws; returns a typed failure with a user-facing message.
 */
export async function resolveRecipientDetailed(
  recipient: string,
  deps: ResolveRecipientDeps,
): Promise<ResolveRecipientResult> {
  const input = recipient.trim();
  const now = deps.now ?? Date.now;

  if (input === "") {
    return { input, ok: false, reason: "invalid_input", message: "Recipient is empty." };
  }

  // 1. Direct address.
  if (isAddress(input)) {
    return {
      ok: true,
      input,
      kind: "address",
      address: getAddress(input),
      source: "direct_address",
      verified: true,
      resolvedAt: now(),
    };
  }

  // 2. QIE domain.
  if (isQieDomain(input)) {
    const registry = deps.domainConfig?.registry;
    const adapter = deps.adapter ?? createResolverAdapter(deps.client, deps.domainConfig);
    const display = normalizeName(input);

    if (adapter.kind === "disabled") {
      return {
        input,
        ok: false,
        reason: "resolver_not_configured",
        message: "QIE Domain Resolver is not configured for this network.",
      };
    }

    let forward: Address | null;
    try {
      forward = await adapter.resolve(stripQieSuffix(input));
    } catch {
      forward = null;
    }
    if (forward === null) {
      return {
        input,
        ok: false,
        reason: "domain_not_found",
        message: "Could not resolve this QIE Domain.",
      };
    }

    // Authoritative adapters (the canonical QIE Domains registry) are trusted as
    // verified. Otherwise reverse-verify against the registry when available; a
    // forward result the registry does not confirm is returned but unverified.
    let verified = adapter.authoritative;
    if (!verified && registry !== undefined) {
      const owned = await reverseLookupQieDomain(deps.client, registry, forward);
      verified = owned !== null && owned === display;
    }

    return {
      ok: true,
      input,
      kind: "qie_domain",
      address: getAddress(forward),
      displayName: display,
      source: "qie_domain_resolver",
      verified,
      resolvedAt: now(),
    };
  }

  // 3. Qevie username fallback.
  try {
    const resolved = (await deps.client.readContract({
      address: deps.contracts.usernameRegistry,
      abi: USERNAME_REGISTRY_ABI,
      functionName: "resolve",
      args: [normalizeName(input)],
    })) as Address;
    if (resolved.toLowerCase() !== ZERO) {
      return {
        ok: true,
        input,
        kind: "qevie_username",
        address: getAddress(resolved),
        displayName: normalizeName(input),
        source: "qevie_username_registry",
        verified: true,
        resolvedAt: now(),
      };
    }
  } catch {
    /* registry unreachable */
  }

  return {
    input,
    ok: false,
    reason: "username_not_found",
    message: `Could not resolve "${input}". Use a 0x address, a registered username, or a name.qie.`,
  };
}
