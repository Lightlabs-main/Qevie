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

// Validate required contract addresses are present.
const requiredContracts: (keyof QevieContracts)[] = [
  "entryPoint",
  "accountFactory",
  "paymaster",
  "batchPayments",
  "paymentRequest",
  "subscriptionManager",
  "usernameRegistry",
  "qusdc",
  "wqie",
  "dexPair",
];

const missingContracts = requiredContracts.filter(
  (k) => contractAddresses[k] === undefined,
);

if (missingContracts.length > 0 && import.meta.env["VITE_SKIP_CONTRACT_CHECK"] !== "true") {
  console.warn(
    `[qevie] Contract addresses missing: ${missingContracts.join(", ")}. ` +
    `Set them in .env or deploy contracts first.`,
  );
}

export const APP_CONFIG = {
  chainId,
  rpcUrl,
  bundlerUrl,
  paymasterServiceUrl,
  appBaseUrl,
  contracts: contractAddresses as QevieContracts,
};
