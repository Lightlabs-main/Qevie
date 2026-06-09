import type { Address } from "viem";

/**
 * Chain-aware, optional configuration for QIE Domain resolution.
 *
 * `enabled` gates the whole feature. `resolver` is a forward resolver contract
 * (name.qie -> address); `registry` is the QIE Domains registry used for reverse
 * verification (address -> name.qie via `userDomain`) and existence checks.
 *
 * When `enabled` is false, or no resolver/registry is configured, `.qie` forward
 * resolution is cleanly UNAVAILABLE — callers must surface a disabled state and
 * MUST NOT fabricate an address.
 */
export interface QieDomainConfig {
  enabled: boolean;
  resolver?: Address;
  registry?: Address;
  /**
   * - `qie_domains`: use the canonical QIE Domains registry `domainInfo(fqn)`
   *   forward method (returns the owner address). Uses `registry`.
   * - `ens_like`: probe a small set of read-only forward method shapes on a
   *   separate `resolver`.
   * - `custom`: use `forwardFunctionName` against `resolver`.
   * - `disabled`: never forward-resolve.
   */
  resolverType?: "qie_domains" | "ens_like" | "custom" | "disabled";
  /** For `custom` resolverType: the forward function name on `resolver`. */
  forwardFunctionName?: string;
}

/** How a recipient string was resolved to an address. */
export type RecipientKind = "address" | "qie_domain" | "qevie_username";

export type RecipientSource =
  | "direct_address"
  | "qie_domain_resolver"
  | "qevie_username_registry";

/** A successfully resolved recipient. */
export interface ResolvedRecipient {
  /** The original input string the user/agent provided. */
  input: string;
  kind: RecipientKind;
  address: Address;
  /** Human-readable label (e.g. the `.qie` domain or username), when known. */
  displayName?: string;
  source: RecipientSource;
  /**
   * `true` when the resolution is trustworthy: a direct address, a username
   * registry hit, or a `.qie` whose address was reverse-verified via the
   * registry's `userDomain`.
   */
  verified: boolean;
  /** Unix ms when resolution was performed. */
  resolvedAt: number;
}

/** Reason a recipient could not be resolved. */
export type ResolveFailureReason =
  | "resolver_not_configured"
  | "domain_not_found"
  | "username_not_found"
  | "invalid_input";

export interface ResolveFailure {
  input: string;
  ok: false;
  reason: ResolveFailureReason;
  message: string;
}

export type ResolveRecipientResult =
  | ({ ok: true } & ResolvedRecipient)
  | ResolveFailure;

/** Minimal adapter for forward QIE Domain resolution (name.qie -> address). */
export interface QieDomainResolverAdapter {
  readonly kind: "qie_domains" | "ens_like" | "custom" | "disabled";
  /**
   * `true` when results come straight from the canonical QIE Domains registry
   * and can be treated as verified without a separate reverse check.
   */
  readonly authoritative: boolean;
  /** Resolve a bare or fully-qualified domain name to an address. */
  resolve(name: string): Promise<Address | null>;
}
