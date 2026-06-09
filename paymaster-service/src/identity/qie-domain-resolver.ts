/**
 * Service-side QIE Domain resolver config.
 *
 * Mirrors the SDK resolver so Strategist previews and Guardian validation use the
 * SAME honest resolution logic the app uses. Forward resolution (name.qie ->
 * address) is only enabled when a resolver is configured; reverse verification
 * uses the verified QIE Domains registry. Nothing is fabricated.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import {
  createResolverAdapter,
  type QieDomainConfig,
  type QieDomainResolverAdapter,
} from "@qevie/sdk";
import { RPC_URL, QIE_DOMAINS_ADDRESS, QIE_DOMAIN_RESOLVER_ADDRESS } from "../config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

let cachedClient: AnyPublicClient | null = null;

export function getResolverPublicClient(): AnyPublicClient {
  cachedClient ??= createPublicClient({ transport: http(RPC_URL) }) as AnyPublicClient;
  return cachedClient;
}

export function getServiceDomainConfig(): QieDomainConfig {
  return {
    enabled: true,
    registry: QIE_DOMAINS_ADDRESS,
    ...(QIE_DOMAIN_RESOLVER_ADDRESS !== undefined ? { resolver: QIE_DOMAIN_RESOLVER_ADDRESS } : {}),
    // Canonical QIE Domains domainInfo() forward resolution via the verified
    // registry; an explicit forward resolver overrides with the ENS-like probe.
    resolverType: QIE_DOMAIN_RESOLVER_ADDRESS !== undefined ? "ens_like" : "qie_domains",
  };
}

export function getServiceResolverAdapter(): QieDomainResolverAdapter {
  return createResolverAdapter(getResolverPublicClient(), getServiceDomainConfig());
}
