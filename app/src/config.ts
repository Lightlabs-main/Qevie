import { MAINNET_CONTRACTS, TESTNET_CONTRACTS, type QevieContracts, type QieDomainConfig } from "@qevie/sdk";

const isTestnet = import.meta.env["VITE_USE_TESTNET"] === "true";

/**
 * Verified QIE Domains registry proxy on QIE mainnet (reverse lookups only:
 * address -> name.qie, domainExist). Forward resolution is NOT assumed — a
 * forward resolver is only used when explicitly configured via env.
 */
const VERIFIED_QIE_DOMAIN_REGISTRY_MAINNET = "0x26cCB3fABd6db18834987134d715Ba2346CE7223";

const chainId: 1990 | 1983 = isTestnet ? 1983 : 1990;

const rpcUrl = isTestnet
  ? (import.meta.env["VITE_TESTNET_RPC"] ?? "https://rpc1testnet.qie.digital/")
  : (import.meta.env["VITE_MAINNET_RPC"] ?? "https://rpc1mainnet.qie.digital/");

const bundlerUrl =
  import.meta.env["VITE_BUNDLER_URL"] ?? "http://localhost:4337";

const paymasterServiceUrl =
  import.meta.env["VITE_PAYMASTER_SERVICE_URL"] ?? "http://localhost:3001";

const appBaseUrl = import.meta.env["VITE_APP_BASE_URL"] ?? "https://app.qevie.io";

const contractAddresses = isTestnet ? TESTNET_CONTRACTS : MAINNET_CONTRACTS;
const receiptRegistry = import.meta.env["VITE_RECEIPT_REGISTRY_ADDRESS"];
const agentPolicyManager = import.meta.env["VITE_AGENT_POLICY_MANAGER_ADDRESS"];
const autopilotExecutionEnabled =
  import.meta.env["VITE_AUTOPILOT_EXECUTION_ENABLED"] === "true";

if (receiptRegistry !== undefined && receiptRegistry !== "") {
  contractAddresses.receiptRegistry = receiptRegistry as `0x${string}`;
}

// QIE Domain Resolver (optional, chain-aware). Registry = reverse verification;
// resolver = forward (name.qie -> address). Neither is faked: with no resolver
// configured, `.qie` forward resolution is cleanly unavailable.
const envResolver = isTestnet
  ? import.meta.env["VITE_QIE_DOMAIN_RESOLVER_TESTNET"]
  : import.meta.env["VITE_QIE_DOMAIN_RESOLVER_MAINNET"];
const envRegistry = isTestnet
  ? import.meta.env["VITE_QIE_DOMAIN_REGISTRY_TESTNET"]
  : import.meta.env["VITE_QIE_DOMAIN_REGISTRY_MAINNET"];

const qieDomainResolver =
  envResolver !== undefined && envResolver !== "" ? (envResolver as `0x${string}`) : undefined;
const qieDomainRegistry =
  envRegistry !== undefined && envRegistry !== ""
    ? (envRegistry as `0x${string}`)
    : isTestnet
      ? undefined
      : (VERIFIED_QIE_DOMAIN_REGISTRY_MAINNET as `0x${string}`);

if (qieDomainResolver !== undefined) contractAddresses.qieDomainResolver = qieDomainResolver;
if (qieDomainRegistry !== undefined) contractAddresses.qieDomainRegistry = qieDomainRegistry;

const qieDomain: QieDomainConfig = {
  enabled: qieDomainResolver !== undefined || qieDomainRegistry !== undefined,
  ...(qieDomainResolver !== undefined ? { resolver: qieDomainResolver } : {}),
  ...(qieDomainRegistry !== undefined ? { registry: qieDomainRegistry } : {}),
  // With the verified registry present, the canonical QIE Domains domainInfo()
  // forward method is used; an explicit forward resolver uses the ENS-like probe.
  resolverType: qieDomainResolver !== undefined
    ? "ens_like"
    : qieDomainRegistry !== undefined
      ? "qie_domains"
      : "disabled",
};

if (!isTestnet) {
  const missing = (Object.keys(contractAddresses) as (keyof QevieContracts)[]).filter(
    (k) => contractAddresses[k] === undefined,
  );
  if (missing.length > 0 && import.meta.env["VITE_SKIP_CONTRACT_CHECK"] !== "true") {
    console.warn(`[qevie] Missing mainnet contract addresses: ${missing.join(", ")}`);
  }
}

export const APP_CONFIG = {
  chainId,
  rpcUrl,
  bundlerUrl,
  paymasterServiceUrl,
  appBaseUrl,
  agentPolicyManager:
    agentPolicyManager !== undefined && agentPolicyManager !== ""
      ? agentPolicyManager as `0x${string}`
      : contractAddresses.agentPolicyManager,
  autopilotExecutionEnabled,
  contracts: contractAddresses as QevieContracts,
  qieDomain,
};
