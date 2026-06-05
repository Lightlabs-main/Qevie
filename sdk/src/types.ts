import type { Address, Hash, Hex } from "viem";

// ---------------------------------------------------------------------------
// Signer abstraction
// ---------------------------------------------------------------------------

export interface QevieSigner {
  getAddress(): Promise<Address>;
  signMessage(message: Uint8Array | string): Promise<Hex>;
}

// ---------------------------------------------------------------------------
// UserOperation lifecycle
// ---------------------------------------------------------------------------

export type UserOpStatus = "pending" | "bundled" | "mined" | "failed";

export interface UserOpResult {
  userOpHash: Hex;
  txHash: Hash | null;
  status: UserOpStatus;
  blockNumber: bigint | null;
}

// ---------------------------------------------------------------------------
// Gas mode
// ---------------------------------------------------------------------------

/**
 * Gas payment mode for a UserOperation:
 * - `sponsored`: paymaster Mode B (fully gasless, Sybil-capped to 3 ops/account).
 * - `qusdc`: paymaster Mode A (account pays gas in QUSDC; needs prior approval).
 * - `self`: no paymaster — the smart account pays its own gas in native QIE.
 *   Used once an account exhausts its free sponsored ops but holds QIE.
 */
export type GasMode = "sponsored" | "qusdc" | "self";

export interface GasQuote {
  mode: GasMode;
  /** Estimated QUSDC cost (6-decimal units). Zero for sponsored mode. */
  qusdcCost: bigint;
  /** Human-readable label: "Free (2 remaining)" or "~$0.03 QUSDC". */
  label: string;
  /** Remaining free ops for sponsored mode, undefined for qusdc mode. */
  freeOpsRemaining?: number;
}

// ---------------------------------------------------------------------------
// Payment types
// ---------------------------------------------------------------------------

export interface PayParams {
  /** Recipient: username, QIE domain (name.qie), or 0x address. */
  to: string;
  /** Amount in QUSDC 6-decimal units. */
  amount: bigint;
  /** Optional memo string (truncated to 31 bytes on-chain). */
  memo?: string;
  mode?: GasMode;
  /** Allowlist token for sponsored mode (issued by paymaster-service). */
  allowlistToken?: AllowlistToken;
}

export interface BatchPayParams {
  recipients: Array<{ to: string; amount: bigint }>;
  memo?: string;
  mode?: GasMode;
  allowlistToken?: AllowlistToken;
}

export interface RequestParams {
  from?: string;
  amount: bigint;
  memo?: string;
  expirySeconds?: number;
}

export interface RequestRecord {
  requestId: bigint;
  requestor: Address;
  payer: Address;
  amount: bigint;
  memo: string;
  expiry: bigint;
  status: "pending" | "paid" | "cancelled";
}

// ---------------------------------------------------------------------------
// Subscription types
// ---------------------------------------------------------------------------

export interface SubscribeParams {
  payee: string;
  amount: bigint;
  /** Period in seconds (minimum 86400 = 1 day). */
  period: number;
  maxPayments: number;
  /** Unix timestamp for first charge. Defaults to now. */
  startAt?: number;
  mode?: GasMode;
  allowlistToken?: AllowlistToken;
}

export interface SubscriptionRecord {
  subId: bigint;
  payer: Address;
  payee: Address;
  amount: bigint;
  period: bigint;
  maxPayments: bigint;
  paymentsMade: bigint;
  nextChargeAt: bigint;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Payment links / QR
// ---------------------------------------------------------------------------

export interface PaymentLinkParams {
  to: string;
  amount?: bigint;
  memo?: string;
  expirySeconds?: number;
  /** Maximum number of times this link may be paid. Undefined = unlimited. */
  maxUses?: number;
}

export interface ParsedPaymentLink {
  to: string;
  amount?: bigint;
  memo?: string;
  /** Unix timestamp (seconds) when the link expires. */
  expiry?: number;
  /** Maximum number of times the link may be paid. */
  maxUses?: number;
  linkId?: string;
}

// ---------------------------------------------------------------------------
// Allowlist token (Mode B sponsored tier)
// ---------------------------------------------------------------------------

export interface AllowlistToken {
  expiry: number;
  signature: Hex;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface QevieClientConfig {
  chainId: 1990 | 1983;
  rpcUrl: string;
  bundlerUrl: string;
  paymasterServiceUrl: string;
  contracts: import("./contracts.js").QevieContracts;
  /** Default salt for smart account derivation. Defaults to 0. */
  defaultSalt?: bigint;
}
