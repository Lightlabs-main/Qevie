/**
 * Service-side recipient resolution — PREVIEW ONLY.
 *
 * The Strategist may produce readable `.qie` / username labels and call this to
 * preview the address they resolve to. The Guardian validates resolved addresses
 * against policy. The Executor, however, ALWAYS pays the address stored on the
 * Autopilot policy/intent — it never re-resolves a `.qie` to override a locked
 * policy address. This prevents silent recipient redirection if a domain changes.
 */

import {
  resolveRecipientDetailed,
  type ResolveRecipientResult,
} from "@qevie/sdk";
import { CONTRACTS } from "../config.js";
import { getResolverPublicClient, getServiceDomainConfig, getServiceResolverAdapter } from "./qie-domain-resolver.js";

/**
 * Resolve a recipient label for PREVIEW. Does not, and must not, be used to
 * substitute an executing policy's locked recipient address.
 */
export async function resolveRecipientForPreview(input: string): Promise<ResolveRecipientResult> {
  return resolveRecipientDetailed(input, {
    client: getResolverPublicClient(),
    contracts: CONTRACTS,
    domainConfig: getServiceDomainConfig(),
    adapter: getServiceResolverAdapter(),
  });
}
