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
export const RECEIPT_ISSUER_PRIVATE_KEY = (): string =>
  process.env["RECEIPT_ISSUER_PRIVATE_KEY"] ?? SIGNER_PRIVATE_KEY();
export const RECEIPT_REGISTRY_ADDRESS = process.env["RECEIPT_REGISTRY_ADDRESS"] as Address | undefined;

export const CONTRACTS = (CHAIN_ID === 1983 ? TESTNET_CONTRACTS : MAINNET_CONTRACTS) as QevieContracts;

export const QIE_DOMAINS_ADDRESS: Address = "0x26cCB3fABd6db18834987134d715Ba2346CE7223";
