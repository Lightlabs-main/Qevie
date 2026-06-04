import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  encodeFunctionData,
  isAddress,
  keccak256,
  toBytes,
  type PublicClient,
} from "viem";
import {
  BATCH_PAYMENTS_ABI,
  PAYMENT_REQUEST_ABI,
  SUBSCRIPTION_MANAGER_ABI,
  USERNAME_REGISTRY_ABI,
} from "./abis.js";
import { QevieAccount } from "./account.js";
import { BundlerClient } from "./bundler.js";
import { resolveRecipient } from "./resolve.js";
import { buildPaymentUri, parsePaymentUri, buildShareUrl } from "./links.js";
import type { QevieContracts } from "./contracts.js";
import type {
  QevieClientConfig,
  QevieSigner,
  GasMode,
  GasQuote,
  PayParams,
  BatchPayParams,
  RequestParams,
  SubscribeParams,
  SubscriptionRecord,
  UserOpResult,
  PaymentLinkParams,
  ParsedPaymentLink,
  AllowlistToken,
} from "./types.js";
import { DEFAULT_GAS } from "./userop.js";

// Use a loose public client type to avoid viem's strict account-field variance checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

export function createQevieClient(config: QevieClientConfig): QevieClient {
  return new QevieClient(config);
}

export class QevieClient {
  readonly config: QevieClientConfig;
  readonly publicClient: AnyPublicClient;
  readonly bundler: BundlerClient;

  constructor(config: QevieClientConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    }) as AnyPublicClient;
    this.bundler = new BundlerClient(config.bundlerUrl);
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  account(signer: QevieSigner, salt?: bigint): QevieAccount {
    return new QevieAccount(
      signer,
      this.publicClient,
      this.config.contracts,
      this.config.chainId,
      salt ?? this.config.defaultSalt ?? 0n,
    );
  }

  async getSmartAccountAddress(signer: QevieSigner, salt?: bigint): Promise<Address> {
    return this.account(signer, salt).getAddress();
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  async resolve(recipient: string): Promise<Address | null> {
    return resolveRecipient(
      this.publicClient,
      this.config.contracts,
      recipient,
    );
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------

  async pay(signer: QevieSigner, params: PayParams): Promise<UserOpResult> {
    const acc = this.account(signer);
    const toAddress = await this._requireResolve(params.to);
    const mode = params.mode ?? "qusdc";

    const transferData = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "transfer",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "transfer",
      args: [toAddress, params.amount],
    });

    const callData = this._encodeExecute(this.config.contracts.qusdc, 0n, transferData);
    return this._submitOp(acc, callData, mode, params.allowlistToken);
  }

  async batchPay(signer: QevieSigner, params: BatchPayParams): Promise<UserOpResult> {
    const acc = this.account(signer);
    const mode = params.mode ?? "qusdc";

    const resolved = await Promise.all(
      params.recipients.map(async (r) => ({
        to: await this._requireResolve(r.to),
        amount: r.amount,
      })),
    );

    const batchId = keccak256(toBytes(`${Date.now()}`)) as Hex;
    const batchCallData = encodeFunctionData({
      abi: BATCH_PAYMENTS_ABI,
      functionName: "batchPay",
      args: [resolved.map((r) => r.to), resolved.map((r) => r.amount), batchId],
    });

    const callData = this._encodeExecute(this.config.contracts.batchPayments, 0n, batchCallData);
    return this._submitOp(acc, callData, mode, params.allowlistToken);
  }

  async requestPayment(signer: QevieSigner, params: RequestParams): Promise<UserOpResult> {
    const acc = this.account(signer);

    const payerAddress: Address = params.from
      ? await this._requireResolve(params.from)
      : "0x0000000000000000000000000000000000000000";

    const memoHex = this._memoToBytes32(params.memo ?? "");
    const expiryDelta = BigInt(params.expirySeconds ?? 86400 * 30);

    const reqCallData = encodeFunctionData({
      abi: PAYMENT_REQUEST_ABI,
      functionName: "createRequest",
      args: [payerAddress, params.amount, memoHex, expiryDelta],
    });

    const callData = this._encodeExecute(this.config.contracts.paymentRequest, 0n, reqCallData);
    return this._submitOp(acc, callData, "qusdc");
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  async subscribe(signer: QevieSigner, params: SubscribeParams): Promise<UserOpResult> {
    const acc = this.account(signer);
    const payeeAddress = await this._requireResolve(params.payee);
    const mode = params.mode ?? "qusdc";

    const subCallData = encodeFunctionData({
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "subscribe",
      args: [
        payeeAddress,
        params.amount,
        BigInt(params.period),
        BigInt(params.maxPayments),
        params.startAt ? BigInt(params.startAt) : 0n,
      ],
    });

    const callData = this._encodeExecute(
      this.config.contracts.subscriptionManager,
      0n,
      subCallData,
    );
    return this._submitOp(acc, callData, mode, params.allowlistToken);
  }

  async cancelSubscription(
    signer: QevieSigner,
    subId: bigint,
    mode: GasMode = "qusdc",
  ): Promise<UserOpResult> {
    const acc = this.account(signer);
    const cancelCallData = encodeFunctionData({
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "cancel",
      args: [subId],
    });
    const callData = this._encodeExecute(
      this.config.contracts.subscriptionManager,
      0n,
      cancelCallData,
    );
    return this._submitOp(acc, callData, mode);
  }

  async getSubscription(subId: bigint): Promise<SubscriptionRecord> {
    const result = await this.publicClient.readContract({
      address: this.config.contracts.subscriptionManager,
      abi: SUBSCRIPTION_MANAGER_ABI,
      functionName: "getSubscription",
      args: [subId],
    }) as {
      payer: Address;
      payee: Address;
      amount: bigint;
      period: bigint;
      maxPayments: bigint;
      paymentsMade: bigint;
      nextChargeAt: bigint;
      active: boolean;
    };

    return { subId, ...result };
  }

  // ---------------------------------------------------------------------------
  // Username registration
  // ---------------------------------------------------------------------------

  async registerUsername(signer: QevieSigner, username: string): Promise<UserOpResult> {
    const acc = this.account(signer);
    const regCallData = encodeFunctionData({
      abi: USERNAME_REGISTRY_ABI,
      functionName: "register",
      args: [username],
    });
    const callData = this._encodeExecute(
      this.config.contracts.usernameRegistry,
      0n,
      regCallData,
    );
    return this._submitOp(acc, callData, "qusdc");
  }

  // ---------------------------------------------------------------------------
  // Gas quoting
  // ---------------------------------------------------------------------------

  async quoteGas(
    signer: QevieSigner,
    mode: GasMode,
    _allowlistToken?: AllowlistToken,
  ): Promise<GasQuote> {
    return this.account(signer).quoteGas(mode);
  }

  // ---------------------------------------------------------------------------
  // Payment links / QR
  // ---------------------------------------------------------------------------

  buildQrUri(params: PaymentLinkParams): string {
    return buildPaymentUri(params);
  }

  parseQrUri(uri: string): ParsedPaymentLink | null {
    return parsePaymentUri(uri);
  }

  createPaymentLink(appBaseUrl: string, params: PaymentLinkParams): string {
    return buildShareUrl(appBaseUrl, params);
  }

  parsePaymentLink(url: string): ParsedPaymentLink | null {
    return parsePaymentUri(url);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async _submitOp(
    acc: QevieAccount,
    callData: Hex,
    mode: GasMode,
    allowlistToken?: AllowlistToken,
  ): Promise<UserOpResult> {
    const op = await acc.buildAndSign(callData, mode, DEFAULT_GAS, allowlistToken);
    const userOpHash = await this.bundler.sendUserOperation(op, this.config.contracts.entryPoint);
    return this.bundler.waitForUserOp(userOpHash);
  }

  private async _requireResolve(recipient: string): Promise<Address> {
    if (isAddress(recipient)) return recipient as Address;
    const resolved = await this.resolve(recipient);
    if (resolved === null) {
      throw new Error(`Cannot resolve recipient: ${recipient}`);
    }
    return resolved;
  }

  private _encodeExecute(target: Address, value: bigint, data: Hex): Hex {
    return encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "execute",
          inputs: [
            { name: "target", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" },
          ],
          outputs: [{ type: "bytes" }],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "execute",
      args: [target, value, data],
    });
  }

  private _memoToBytes32(memo: string): Hex {
    const encoded = new TextEncoder().encode(memo.slice(0, 31));
    const padded = new Uint8Array(32);
    padded.set(encoded);
    return `0x${Buffer.from(padded).toString("hex")}` as Hex;
  }
}
