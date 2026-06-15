/**
 * Domain "indexer" — QIE Domain resolution metrics (service-sourced).
 *
 * `.qie` resolution happens in this service (the `/resolve-recipient` preview
 * path), not as an on-chain event, so these metrics are recorded at resolution
 * time rather than scanned from chain logs. This is the honest source: it counts
 * exactly the resolutions the service performed. When no resolver/registry is
 * configured for the active network, nothing is recorded and the aggregator
 * reports domains as "not configured".
 *
 * Recording is best-effort: a stats write must never affect a resolution result.
 */

import type { ResolveRecipientResult } from "@qevie/sdk";
import type { QevieProtocolEvent } from "@qevie/sdk";
import { CHAIN_ID } from "../config.js";
import { getServiceDomainConfig } from "../identity/qie-domain-resolver.js";
import { upsertEvents } from "./store.js";

export function domainsConfigured(): boolean {
  return getServiceDomainConfig().enabled === true;
}

function isQieDomainInput(input: string): boolean {
  return input.trim().toLowerCase().endsWith(".qie");
}

/**
 * Record a `.qie` resolution outcome as a protocol event. Plain-address and
 * username inputs are ignored — only genuine domain resolutions are counted.
 */
export function recordDomainResolution(result: ResolveRecipientResult): void {
  if (!domainsConfigured()) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    if (result.ok && result.kind === "qie_domain") {
      const input = result.displayName ?? result.input;
      const ev: QevieProtocolEvent = {
        id: `${CHAIN_ID}:domain:${Date.now()}:${input}`,
        chainId: CHAIN_ID,
        type: "DOMAIN_RESOLVED",
        status: "confirmed",
        timestamp: now,
        qieDomainInput: input,
        resolvedAddress: result.address,
      };
      upsertEvents([ev]);
      return;
    }
    if (!result.ok && isQieDomainInput(result.input)) {
      const ev: QevieProtocolEvent = {
        id: `${CHAIN_ID}:domain:${Date.now()}:${result.input}`,
        chainId: CHAIN_ID,
        type: "DOMAIN_RESOLUTION_FAILED",
        status: "failed",
        timestamp: now,
        qieDomainInput: result.input,
        reason: result.message,
      };
      upsertEvents([ev]);
    }
  } catch (e) {
    console.error("[indexer] recordDomainResolution failed:", e);
  }
}
