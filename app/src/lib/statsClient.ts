/**
 * App-side protocol-stats client.
 *
 * Thin wrapper around the SDK `StatsModule` pointed at this deployment's stats
 * API (the paymaster-service that runs the indexer). All reads are real indexed
 * data; when the API is unreachable the callers fall back to clear empty states
 * (never fabricated numbers).
 */

import { StatsModule } from "@qevie/sdk";
import type {
  MyStatsResponse,
  ProtocolEventsResponse,
  ProtocolStatsResponse,
  QevieProtocolEvent,
  QevieProtocolEventType,
} from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

export type {
  MyStatsResponse,
  ProtocolEventsResponse,
  ProtocolStatsResponse,
  QevieProtocolEvent,
  QevieProtocolEventType,
};

export const statsClient = new StatsModule(APP_CONFIG.statsApiUrl);

export const NETWORK_LABEL: "QIE Mainnet" | "QIE Testnet" =
  APP_CONFIG.chainId === 1983 ? "QIE Testnet" : "QIE Mainnet";

/** Format a base-unit (6-dec) QUSDC string as a human dollar amount. */
export function formatQusdcAmount(baseUnits: string | undefined): string {
  if (baseUnits === undefined) return "0.00";
  let value: number;
  try {
    value = Number(BigInt(baseUnits)) / 1e6;
  } catch {
    return "0.00";
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Short human label + relative time for a protocol event (mini + full feeds). */
export function eventLabel(type: QevieProtocolEventType): string {
  switch (type) {
    case "POLICY_CREATED": return "Policy created";
    case "POLICY_PENDING": return "Policy pending";
    case "POLICY_REVOKED": return "Policy revoked";
    case "GUARDIAN_REVOKED": return "Guardian vetoed";
    case "SESSION_EXECUTED": return "Autopilot executed";
    case "SESSION_BATCH_EXECUTED": return "Autopilot batch executed";
    case "PAYMENT_EXECUTED": return "QUSDC sent";
    case "BATCH_EXECUTED": return "Batch paid";
    case "REQUEST_SETTLED": return "Request settled";
    case "SUBSCRIPTION_EXECUTED": return "Subscription charged";
    case "PAYMASTER_SPONSORED": return "Gas sponsored";
    case "QUSDC_GAS_CHARGED": return "Gas paid in QUSDC";
    case "RECEIPT_CREATED": return "Receipt written";
    case "DOMAIN_RESOLVED": return "Domain resolved";
    case "DOMAIN_RESOLUTION_FAILED": return "Domain resolution failed";
    default: return type;
  }
}

export function relativeTime(timestampSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const delta = Math.max(0, nowSeconds - timestampSeconds);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Block explorer base for the active chain (matches the rest of the app). */
const EXPLORER_BASE = APP_CONFIG.chainId === 1990
  ? "https://mainnet.qie.digital"
  : "https://testnet.qie.digital";

export function explorerTxUrl(txHash: string | undefined): string | null {
  if (txHash === undefined) return null;
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

export function eventKey(e: QevieProtocolEvent): string {
  return e.id;
}
