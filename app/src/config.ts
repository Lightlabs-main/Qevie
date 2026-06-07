import { MAINNET_CONTRACTS, TESTNET_CONTRACTS, type QevieContracts } from "@qevie/sdk";

const isTestnet = import.meta.env["VITE_USE_TESTNET"] === "true";

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

if (receiptRegistry !== undefined && receiptRegistry !== "") {
  contractAddresses.receiptRegistry = receiptRegistry as `0x${string}`;
}

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
      : undefined,
  contracts: contractAddresses as QevieContracts,
};
