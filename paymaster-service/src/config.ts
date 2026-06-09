import { TESTNET_CONTRACTS, MAINNET_CONTRACTS, type QevieContracts } from "@qevie/sdk";
import type { Address } from "viem";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (val === undefined || val === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const CHAIN_ID: 1990 | 1983 =
  process.env["USE_TESTNET"] === "true" ? 1983 : 1990;

export const RPC_URL = optionalEnv(
  CHAIN_ID === 1983 ? "TESTNET_RPC_URL" : "MAINNET_RPC_URL",
  CHAIN_ID === 1983 ? "https://rpc1testnet.qie.digital/" : "https://rpc1mainnet.qie.digital/",
);

export const BUNDLER_URL = optionalEnv("BUNDLER_URL", "http://localhost:4337");
export const PORT = Number(optionalEnv("PORT", "3001"));

/** Private key for the paymaster-service signer (used for allowlist token signing). */
export const SIGNER_PRIVATE_KEY = (): string => requireEnv("PAYMASTER_SIGNER_PRIVATE_KEY");

/**
 * Secret used to encrypt Autopilot session private keys at rest (AES-256-GCM).
 * Required for /session-key provisioning; without it the endpoint fails closed
 * so plaintext keys are never written to disk.
 */
export const SESSION_KEY_ENC_SECRET = (): string => requireEnv("SESSION_KEY_ENC_SECRET");
/** File path for the encrypted session-key store. */
export const SESSION_KEY_STORE_PATH = (): string =>
  optionalEnv("SESSION_KEY_STORE_PATH", "./data/session-keys.json");

/** Whether the Autopilot executor loop runs (signs due intents unattended). */
export const AUTOPILOT_EXECUTOR_ENABLED = process.env["AUTOPILOT_EXECUTOR_ENABLED"] !== "false";
/** Poll interval for the Autopilot executor loop, in milliseconds. */
export const AUTOPILOT_POLL_INTERVAL_MS = Number(
  optionalEnv("AUTOPILOT_POLL_INTERVAL_MS", "60000"),
);
/** File path for the Autopilot intent store. */
export const AUTOPILOT_INTENT_STORE_PATH = (): string =>
  optionalEnv("AUTOPILOT_INTENT_STORE_PATH", "./data/autopilot-intents.json");
export const RECEIPT_ISSUER_PRIVATE_KEY = (): string =>
  process.env["RECEIPT_ISSUER_PRIVATE_KEY"] ?? SIGNER_PRIVATE_KEY();
export const RECEIPT_REGISTRY_ADDRESS = process.env["RECEIPT_REGISTRY_ADDRESS"] as Address | undefined;

export const CONTRACTS = (CHAIN_ID === 1983 ? TESTNET_CONTRACTS : MAINNET_CONTRACTS) as QevieContracts;

/**
 * Testnet-only: private key that owns the TestDexPair stub. The stub only
 * refreshes its price timestamp when `setReserves` is called, so the keeper
 * pings it periodically to keep the QUSDC_GAS quote fresh (the paymaster
 * rejects quotes older than its staleness limit). On mainnet a real QIEDex
 * pool refreshes on every swap, so this is unused. Falls back to the testnet
 * deployer key if a dedicated key is not provided.
 */
export const DEX_REFRESH_PRIVATE_KEY = (): string | undefined =>
  process.env["DEX_REFRESH_PRIVATE_KEY"] ?? process.env["TESTNET_PRIVATE_KEY"];

export const QIE_DOMAINS_ADDRESS: Address = "0x26cCB3fABd6db18834987134d715Ba2346CE7223";

/**
 * Optional forward QIE Domain resolver (name.qie -> address). When unset, `.qie`
 * forward resolution is cleanly unavailable on the service side (never faked);
 * reverse verification still works through QIE_DOMAINS_ADDRESS.
 */
export const QIE_DOMAIN_RESOLVER_ADDRESS = process.env["QIE_DOMAIN_RESOLVER_ADDRESS"] as
  | Address
  | undefined;
