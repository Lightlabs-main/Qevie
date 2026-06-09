import { type Address, type PublicClient } from "viem";
import type { QieDomainConfig, QieDomainResolverAdapter } from "./types.js";
import { resolveOwnerViaDomainInfo, stripQieSuffix, tryChecksum } from "./qieDomains.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

const ZERO = "0x0000000000000000000000000000000000000000";

function isNonZeroAddress(value: unknown): value is Address {
  if (typeof value !== "string") return false;
  const checksummed = tryChecksum(value);
  return checksummed !== null && checksummed.toLowerCase() !== ZERO;
}

/**
 * Common read-only forward-resolution method shapes seen on ENS-like resolvers.
 * We don't assume a single ABI — we probe these and accept the first that
 * returns a non-zero address. If none do, the domain is treated as unresolved
 * (the caller blocks; nothing is fabricated).
 */
const ENS_LIKE_FORWARD_FUNCTIONS = [
  "resolve",
  "getAddress",
  "resolveDomain",
  "addr",
  "domainToAddress",
  "addressOf",
] as const;

function forwardAbi(functionName: string) {
  return [
    {
      type: "function",
      name: functionName,
      stateMutability: "view",
      inputs: [{ name: "name", type: "string" }],
      outputs: [{ type: "address" }],
    },
  ] as const;
}

async function probeForward(
  client: AnyPublicClient,
  resolver: Address,
  functionName: string,
  bareName: string,
): Promise<Address | null> {
  try {
    const result = await client.readContract({
      address: resolver,
      abi: forwardAbi(functionName),
      functionName,
      args: [bareName],
    });
    return isNonZeroAddress(result) ? (result as Address) : null;
  } catch {
    return null;
  }
}

/** Forward resolution disabled — always null (reverse verification still works). */
export class DisabledQieResolverAdapter implements QieDomainResolverAdapter {
  readonly kind = "disabled" as const;
  readonly authoritative = false;
  async resolve(_name: string): Promise<Address | null> {
    void _name;
    return null;
  }
}

/**
 * Canonical QIE Domains resolver: reads `domainInfo(fqn).owner` from the verified
 * QIE Domains registry. Results are authoritative (straight from the registry),
 * so they need no separate reverse check.
 */
export class QieDomainsRegistryAdapter implements QieDomainResolverAdapter {
  readonly kind = "qie_domains" as const;
  readonly authoritative = true;
  constructor(
    private readonly client: AnyPublicClient,
    private readonly registry: Address,
  ) {}

  async resolve(name: string): Promise<Address | null> {
    if (stripQieSuffix(name) === "") return null;
    return resolveOwnerViaDomainInfo(this.client, this.registry, name);
  }
}

/** Probes a set of ENS-like forward method shapes on a configured resolver. */
export class EnsLikeQieResolverAdapter implements QieDomainResolverAdapter {
  readonly kind = "ens_like" as const;
  readonly authoritative = false;
  constructor(
    private readonly client: AnyPublicClient,
    private readonly resolver: Address,
  ) {}

  async resolve(name: string): Promise<Address | null> {
    const bare = stripQieSuffix(name);
    if (bare === "") return null;
    for (const fn of ENS_LIKE_FORWARD_FUNCTIONS) {
      const result = await probeForward(this.client, this.resolver, fn, bare);
      if (result !== null) return result;
    }
    return null;
  }
}

/** Calls a single, explicitly-configured forward function on the resolver. */
export class CustomQieResolverAdapter implements QieDomainResolverAdapter {
  readonly kind = "custom" as const;
  readonly authoritative = false;
  constructor(
    private readonly client: AnyPublicClient,
    private readonly resolver: Address,
    private readonly functionName: string,
  ) {}

  async resolve(name: string): Promise<Address | null> {
    const bare = stripQieSuffix(name);
    if (bare === "") return null;
    return probeForward(this.client, this.resolver, this.functionName, bare);
  }
}

/**
 * Build the appropriate forward adapter from config. Returns a Disabled adapter
 * when the feature is off or no resolver is configured — so callers get a clean,
 * honest "unavailable" rather than a fabricated address.
 */
export function createResolverAdapter(
  client: AnyPublicClient,
  config: QieDomainConfig | undefined,
): QieDomainResolverAdapter {
  if (config === undefined || !config.enabled || config.resolverType === "disabled") {
    return new DisabledQieResolverAdapter();
  }
  // Canonical QIE Domains registry method (domainInfo). Preferred whenever a
  // registry is configured and no separate forward resolver overrides it.
  if (config.resolverType === "qie_domains") {
    return config.registry !== undefined
      ? new QieDomainsRegistryAdapter(client, config.registry)
      : new DisabledQieResolverAdapter();
  }
  if (config.resolverType === "custom") {
    if (
      config.resolver === undefined ||
      config.forwardFunctionName === undefined ||
      config.forwardFunctionName === ""
    ) {
      return new DisabledQieResolverAdapter();
    }
    return new CustomQieResolverAdapter(client, config.resolver, config.forwardFunctionName);
  }
  if (config.resolverType === "ens_like" && config.resolver !== undefined) {
    return new EnsLikeQieResolverAdapter(client, config.resolver);
  }
  // No explicit resolver, but a registry is available: use the canonical method.
  if (config.registry !== undefined) {
    return new QieDomainsRegistryAdapter(client, config.registry);
  }
  return new DisabledQieResolverAdapter();
}
