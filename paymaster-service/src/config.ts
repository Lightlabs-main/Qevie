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

// ---------------------------------------------------------------------------
// Bulk Intent Import (CSV → policy-checked QUSDC execution)
// ---------------------------------------------------------------------------

/** JSON store for csv_import_job records. */
export const CSV_IMPORT_JOB_STORE_PATH = (): string =>
  optionalEnv("CSV_IMPORT_JOB_STORE_PATH", "./data/csv-import-jobs.json");
/** JSON store for payment_intent records. */
export const CSV_IMPORT_INTENT_STORE_PATH = (): string =>
  optionalEnv("CSV_IMPORT_INTENT_STORE_PATH", "./data/csv-import-intents.json");
/** Whether the CSV-import Autopilot executor loop runs (session-signed rows). */
export const CSV_IMPORT_EXECUTOR_ENABLED = process.env["CSV_IMPORT_EXECUTOR_ENABLED"] !== "false";
/** Poll interval for the CSV-import executor loop, in milliseconds. */
export const CSV_IMPORT_POLL_INTERVAL_MS = Number(
  optionalEnv("CSV_IMPORT_POLL_INTERVAL_MS", "15000"),
);
/** Duplicate-history lookback window, in hours (default 24). */
export const CSV_IMPORT_LOOKBACK_HOURS = Number(optionalEnv("CSV_IMPORT_LOOKBACK_HOURS", "24"));
/** Chunk size for user-path batchPay grouping (clamped to the on-chain cap). */
export const CSV_IMPORT_BATCH_CHUNK_SIZE = Number(
  optionalEnv("CSV_IMPORT_BATCH_CHUNK_SIZE", "100"),
);
/** Maximum data rows accepted in a single upload. */
export const CSV_IMPORT_MAX_ROWS = Number(optionalEnv("CSV_IMPORT_MAX_ROWS", "500"));
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

/**
 * Paymaster rebalancer.
 *
 * Mode A charges accrue QUSDC inside the paymaster while it spends native QIE
 * sponsoring/fronting gas. To stay solvent that collected QUSDC must be swapped
 * back into native QIE along the QIEDex WQIE/QUSDC route and used to top the dry
 * native-QIE sinks (the EntryPoint deposit and the service signer EOA). This
 * loop closes that economic loop. It uses the paymaster OWNER key (the same key
 * the heartbeat already uses) because `withdrawQUSDC` is owner-only.
 *
 * Safety: disabled-by-default in EXECUTE terms — it only LOGS intended swaps
 * until REBALANCER_LIVE=true, never swaps dust (MIN_QUSDC), never swaps more
 * than MAX_QUSDC per run, and only acts when a sink is actually below its floor.
 */
export const REBALANCER_ENABLED = process.env["REBALANCER_ENABLED"] !== "false";
/** When false (default) the loop logs intended actions but executes nothing. */
export const REBALANCER_LIVE = process.env["REBALANCER_LIVE"] === "true";
export const REBALANCER_INTERVAL_MS = Number(
  optionalEnv("REBALANCER_INTERVAL_MS", String(30 * 60_000)),
);
/** Slippage tolerance applied to the DEX quote, in basis points (default 2%). */
export const REBALANCER_SLIPPAGE_BPS = BigInt(optionalEnv("REBALANCER_SLIPPAGE_BPS", "200"));
/** Never swap less than this much collected QUSDC in one run (6-dec units). */
export const REBALANCER_MIN_QUSDC = BigInt(optionalEnv("REBALANCER_MIN_QUSDC_UNITS", "1000000")); // 1 QUSDC
/** Never swap more than this much collected QUSDC in one run (6-dec units). */
export const REBALANCER_MAX_QUSDC = BigInt(optionalEnv("REBALANCER_MAX_QUSDC_UNITS", "100000000")); // 100 QUSDC
/** Top the EntryPoint deposit up to TARGET when it drops below FLOOR (wei). */
export const REBALANCER_EP_FLOOR_WEI = BigInt(optionalEnv("REBALANCER_EP_FLOOR_WEI", "1000000000000000000")); // 1 QIE
export const REBALANCER_EP_TARGET_WEI = BigInt(optionalEnv("REBALANCER_EP_TARGET_WEI", "3000000000000000000")); // 3 QIE
/** Keep the service signer EOA above FLOOR, topping up to TARGET (wei). */
export const REBALANCER_SIGNER_FLOOR_WEI = BigInt(optionalEnv("REBALANCER_SIGNER_FLOOR_WEI", "200000000000000000")); // 0.2 QIE
export const REBALANCER_SIGNER_TARGET_WEI = BigInt(optionalEnv("REBALANCER_SIGNER_TARGET_WEI", "500000000000000000")); // 0.5 QIE

export const QIE_DOMAINS_ADDRESS: Address = "0x26cCB3fABd6db18834987134d715Ba2346CE7223";

/**
 * Optional forward QIE Domain resolver (name.qie -> address). When unset, `.qie`
 * forward resolution is cleanly unavailable on the service side (never faked);
 * reverse verification still works through QIE_DOMAINS_ADDRESS.
 */
export const QIE_DOMAIN_RESOLVER_ADDRESS = process.env["QIE_DOMAIN_RESOLVER_ADDRESS"] as
  | Address
  | undefined;
