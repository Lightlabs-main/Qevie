// Core client
export { createQevieClient, QevieClient } from "./client.js";

// Account
export { QevieAccount } from "./account.js";

// Bundler
export { BundlerClient } from "./bundler.js";

// Chains
export { qieMainnet, qieTestnet } from "./chains.js";

// Contracts
export { TESTNET_CONTRACTS, MAINNET_CONTRACTS } from "./contracts.js";
export type { QevieContracts } from "./contracts.js";

// Payment links / QR
export { buildPaymentUri, parsePaymentUri, buildShareUrl } from "./links.js";

// Name resolution
export { resolveRecipient } from "./resolve.js";
export { stableStringify, hashReceiptMetadata } from "./receipts.js";

// Types
export type {
  QevieSigner,
  GasMode,
  GasQuote,
  PayParams,
  BatchPayParams,
  RequestParams,
  RequestRecord,
  ReceiptType,
  CreateReceiptInput,
  CreateReceiptResult,
  QevieReceipt,
  PassportStats,
  SubscribeParams,
  SubscriptionRecord,
  UserOpResult,
  UserOpStatus,
  PaymentLinkParams,
  ParsedPaymentLink,
  AllowlistToken,
  QevieClientConfig,
} from "./types.js";

// ABIs (for advanced use cases)
export {
  QUSDC_ABI,
  ENTRY_POINT_ABI,
  ACCOUNT_FACTORY_ABI,
  SMART_ACCOUNT_ABI,
  BATCH_PAYMENTS_ABI,
  PAYMENT_REQUEST_ABI,
  SUBSCRIPTION_MANAGER_ABI,
  RECEIPT_REGISTRY_ABI,
  USERNAME_REGISTRY_ABI,
  PAYMASTER_ABI,
  QIE_DOMAINS_ABI,
} from "./abis.js";
