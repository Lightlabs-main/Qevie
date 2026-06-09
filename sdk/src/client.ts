import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  isAddress,
  keccak256,
  maxUint256,
  parseAbiParameters,
  toBytes,
  type PublicClient,
} from "viem";
import {
  BATCH_PAYMENTS_ABI,
  PAYMENT_REQUEST_ABI,
  QUSDC_ABI,
  RECEIPT_REGISTRY_ABI,
  SMART_ACCOUNT_ABI,
  SUBSCRIPTION_MANAGER_ABI,
  USERNAME_REGISTRY_ABI,
} from "./abis.js";
import { AGENT_POLICY_MANAGER_ABI } from "./agent/abis.js";
import { GasModule, type AutopilotGasDecision } from "./gas.js";
import { QevieAccount } from "./account.js";
import { BundlerClient } from "./bundler.js";
import { resolveRecipient } from "./resolve.js";
import {
  resolveRecipientDetailed,
  createResolverAdapter,
  type ResolveRecipientResult,
  type QieDomainConfig,
  type QieDomainResolverAdapter,
} from "./identity/index.js";
import { buildPaymentUri, parsePaymentUri, buildShareUrl } from "./links.js";
import { hashReceiptMetadata } from "./receipts.js";
import type {
  QevieClientConfig,
  QevieSigner,
  GasMode,
  GasQuote,
  PayParams,
  BatchPayParams,
  RequestParams,
  PayRequestParams,
  CreateReceiptInput,
  CreateReceiptResult,
  PassportStats,
  QevieReceipt,
  ReceiptType,
  SubscribeParams,
  SubscriptionRecord,
  UserOpResult,
  PaymentLinkParams,
  ParsedPaymentLink,
  AllowlistToken,
} from "./types.js";
import type {
  AgentPolicy,
  AgentPolicyDraft,
  CreateAgentPolicyOptions,
  CreateAgentPolicyResult,
  SessionPaymentInput,
} from "./agent/types.js";
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
  readonly receipts: {
    createReceipt: (input: CreateReceiptInput) => Promise<CreateReceiptResult>;
    getReceipt: (receiptId: Hex) => Promise<QevieReceipt>;
    listForAccount: (account: Address) => Promise<QevieReceipt[]>;
    listByPayer: (account: Address) => Promise<QevieReceipt[]>;
    listByPayee: (account: Address) => Promise<QevieReceipt[]>;
    exportReceipt: (receiptId: Hex) => Promise<string>;
  };
  readonly passport: {
    getPassport: (account: Address) => Promise<PassportStats>;
    getStats: (account: Address) => Promise<PassportStats>;
    getRecentReceipts: (account: Address, limit?: number) => Promise<QevieReceipt[]>;
  };
  readonly agent: {
    createSessionPolicy: (
      signer: QevieSigner,
      draft: AgentPolicyDraft,
      options?: CreateAgentPolicyOptions,
    ) => Promise<CreateAgentPolicyResult>;
    listSessionPolicies: (smartAccount: Address) => Promise<AgentPolicy[]>;
    getSessionPolicy: (policyId: Hex) => Promise<AgentPolicy>;
    executeAutopilotPayment: (
      sessionSigner: QevieSigner,
      input: SessionPaymentInput,
      allowlistToken?: AllowlistToken,
    ) => Promise<UserOpResult>;
    getAutopilotGasStatus: (policyId: Hex) => Promise<AutopilotGasDecision>;
  };
  /** Sustainable gas model decision layer (sponsored / QUSDC / native / paused). */
  readonly gas: GasModule;
  /** Effective QIE Domain config (explicit, or derived from contract addresses). */
  readonly qieDomainConfig: QieDomainConfig;
  private readonly resolverAdapter: QieDomainResolverAdapter;

  constructor(config: QevieClientConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    }) as AnyPublicClient;
    this.qieDomainConfig = config.qieDomain ?? deriveQieDomainConfig(config);
    this.resolverAdapter = createResolverAdapter(this.publicClient, this.qieDomainConfig);
    this.bundler = new BundlerClient(config.bundlerUrl);
    this.receipts = {
      createReceipt: this.createReceipt.bind(this),
      getReceipt: this.getReceipt.bind(this),
      listForAccount: this.listForAccount.bind(this),
      listByPayer: this.listByPayer.bind(this),
      listByPayee: this.listByPayee.bind(this),
      exportReceipt: this.exportReceipt.bind(this),
    };
    this.passport = {
      getPassport: this.getPassport.bind(this),
      getStats: this.getStats.bind(this),
      getRecentReceipts: this.getRecentReceipts.bind(this),
    };
    this.gas = new GasModule(this.publicClient, this.config.contracts);
    this.agent = {
      createSessionPolicy: this.createSessionPolicy.bind(this),
      listSessionPolicies: this.listSessionPolicies.bind(this),
      getSessionPolicy: this.getSessionPolicy.bind(this),
      executeAutopilotPayment: this.executeAutopilotPayment.bind(this),
      getAutopilotGasStatus: this.getAutopilotGasStatus.bind(this),
    };
  }

  /**
   * Structured gas decision for an Autopilot policy: which mode it would use on
   * its next run, sponsored quota, and QUSDC-gas estimate. Honest about pause.
   */
  async getAutopilotGasStatus(policyId: Hex): Promise<AutopilotGasDecision> {
    const policy = await this.getSessionPolicy(policyId);
    return this.gas.resolveGasMode(policy.smartAccount, {
      allowSponsoredGas: policy.allowSponsoredGas,
      allowQusdcGas: policy.allowQusdcGas,
      allowNativeQieFallback: policy.allowNativeQieFallback,
      pauseWhenGasUnavailable: policy.pauseWhenGasUnavailable,
    });
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

  /**
   * Check whether a smart account has approved the paymaster to pull QUSDC for
   * gas (QUSDC_GAS / Mode A). The paymaster validates this allowance BEFORE an
   * op executes, so it must be set in advance.
   */
  async isQusdcGasReady(smartAccount: Address): Promise<boolean> {
    const allowance = (await this.publicClient.readContract({
      address: this.config.contracts.qusdc,
      abi: QUSDC_ABI,
      functionName: "allowance",
      args: [smartAccount, this.config.contracts.paymaster],
    })) as bigint;
    // Treat a large remaining allowance as "armed".
    return allowance >= maxUint256 / 2n;
  }

  /**
   * Arm QUSDC_GAS for an account: approve the paymaster to pull QUSDC for gas.
   *
   * This is the one-time bootstrap that makes "pay gas in USDC" work. Because
   * the paymaster checks the allowance during validation (before the op runs),
   * the approval cannot be self-bootstrapped by the first USDC-gas op — it has
   * to be set first. On testnet we set it with a sponsored op (free onboarding);
   * idempotent — a no-op if already armed.
   *
   * Returns `{ armed: true }` when the allowance is in place (already or after a
   * successful op). Returns `{ armed: false, reason }` if no sponsored route is
   * available to pay for the approval (e.g. mainnet with the free tier off and
   * the account holding no native QIE) — the caller must surface that.
   */
  async ensureQusdcGasReady(
    signer: QevieSigner,
  ): Promise<{ armed: boolean; alreadyArmed: boolean; userOpHash?: Hex; reason?: string }> {
    const acc = this.account(signer);
    const smartAccount = await acc.getAddress();

    if (await this.isQusdcGasReady(smartAccount)) {
      return { armed: true, alreadyArmed: true };
    }

    const approveData = encodeFunctionData({
      abi: QUSDC_ABI,
      functionName: "approve",
      args: [this.config.contracts.paymaster, maxUint256],
    });
    const callData = this._encodeExecute(this.config.contracts.qusdc, 0n, approveData);

    // Prefer a sponsored op so the user pays nothing to arm USDC gas (testnet
    // onboarding). If the account has no sponsored quota, fall back to self-paid.
    const token = await this.getAllowlistToken(smartAccount);
    const mode: GasMode = token !== null ? "sponsored" : "self";
    if (mode === "self") {
      // Without a sponsored route the account must hold native QIE to arm.
      // Surface this rather than submitting a doomed op.
      const bal = await this.publicClient.getBalance({ address: smartAccount });
      if (bal === 0n) {
        return {
          armed: false,
          alreadyArmed: false,
          reason: "No sponsored quota and no native QIE to approve the paymaster for USDC gas",
        };
      }
    }

    const userOpHash = await this._submitOpNoWait(acc, callData, mode, token ?? undefined);
    const result = await this.bundler.waitForUserOp(userOpHash);
    return {
      armed: result.status === "mined",
      alreadyArmed: false,
      userOpHash,
      ...(result.status === "mined" ? {} : { reason: "Approval op did not mine" }),
    };
  }

  // ---------------------------------------------------------------------------
  // Autopilot
  // ---------------------------------------------------------------------------

  async createSessionPolicy(
    signer: QevieSigner,
    draft: AgentPolicyDraft,
    options: CreateAgentPolicyOptions = {},
  ): Promise<CreateAgentPolicyResult> {
    const manager = this._requireAgentPolicyManager();
    const account = this.account(signer);
    const [smartAccount, owner] = await Promise.all([
      account.getAddress(),
      signer.getAddress(),
    ]);
    const nonce = await this.publicClient.readContract({
      address: manager,
      abi: AGENT_POLICY_MANAGER_ABI,
      functionName: "policyNonce",
      args: [smartAccount],
    }) as bigint;

    const policyId = keccak256(encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId, address smartAccount, address sessionKey, address owner, uint256 nonce",
      ),
      [BigInt(this.config.chainId), smartAccount, draft.sessionKey, owner, nonce],
    ));

    const managerCall = encodeFunctionData({
      abi: AGENT_POLICY_MANAGER_ABI,
      functionName: "createPolicy",
      args: [{
        smartAccount,
        sessionKey: draft.sessionKey,
        guardian: draft.guardian,
        token: this.config.contracts.qusdc,
        maxPerTx: draft.maxPerTx,
        dailyLimit: draft.dailyLimit,
        weeklyLimit: draft.weeklyLimit,
        totalLimit: draft.totalLimit,
        maxQusdcGasPerTx: draft.maxQusdcGasPerTx,
        dailyQusdcGasCap: draft.dailyQusdcGasCap,
        validAfter: draft.validAfter,
        validUntil: draft.validUntil,
        allowSinglePayment: draft.allowSinglePayment,
        allowBatchPayment: draft.allowBatchPayment,
        allowPaymentRequest: draft.allowPaymentRequest,
        allowSubscription: draft.allowSubscription,
        allowSponsoredGas: draft.allowSponsoredGas,
        allowQusdcGas: draft.allowQusdcGas,
        allowNativeQieFallback: draft.allowNativeQieFallback,
        pauseWhenGasUnavailable: draft.pauseWhenGasUnavailable,
        recipients: draft.recipients,
      }],
    });
    const callData = this._encodeExecute(manager, 0n, managerCall);
    const mode = options.mode ?? "sponsored";
    const token = mode === "sponsored"
      ? await this.getAllowlistToken(smartAccount)
      : null;
    if (mode === "sponsored" && token === null) {
      throw new Error("Sponsored onboarding is unavailable for this smart account.");
    }
    const userOpHash = await this._submitOpNoWait(
      account,
      callData,
      mode,
      token ?? undefined,
      { ...DEFAULT_GAS, callGasLimit: 650_000n },
    );

    if (options.waitForReceipt === false) {
      return { policyId, userOpHash };
    }
    const result = await this.bundler.waitForUserOp(userOpHash, 50, 1000);
    if (result.status === "failed") {
      throw new Error("Policy UserOperation failed on-chain.");
    }
    return { policyId, userOpHash, result };
  }

  async listSessionPolicies(smartAccount: Address): Promise<AgentPolicy[]> {
    const manager = this._requireAgentPolicyManager();
    const ids = await this.publicClient.readContract({
      address: manager,
      abi: AGENT_POLICY_MANAGER_ABI,
      functionName: "getPoliciesBySmartAccount",
      args: [smartAccount],
    }) as Hex[];
    return Promise.all(ids.map((id) => this.getSessionPolicy(id)));
  }

  async getSessionPolicy(policyId: Hex): Promise<AgentPolicy> {
    const manager = this._requireAgentPolicyManager();
    const policy = await this.publicClient.readContract({
      address: manager,
      abi: AGENT_POLICY_MANAGER_ABI,
      functionName: "getPolicy",
      args: [policyId],
    }) as Omit<AgentPolicy, "policyId">;
    return { policyId, ...policy };
  }

  async executeAutopilotPayment(
    sessionSigner: QevieSigner,
    input: SessionPaymentInput,
    allowlistToken?: AllowlistToken,
  ): Promise<UserOpResult> {
    const transferData = encodeFunctionData({
      abi: QUSDC_ABI,
      functionName: "transfer",
      args: [input.recipient, input.amount],
    });
    const callData = encodeFunctionData({
      abi: SMART_ACCOUNT_ABI,
      functionName: "executeSession",
      args: [
        input.policyId,
        this.config.contracts.qusdc,
        0n,
        transferData,
      ],
    });
    const account = this.account(sessionSigner);
    const op = await account.buildAndSignSession(
      input.smartAccount,
      input.policyId,
      callData,
      input.mode,
      sessionSigner,
      { ...DEFAULT_GAS, callGasLimit: 400_000n },
      allowlistToken,
    );
    const userOpHash = await this.bundler.sendUserOperation(
      op,
      this.config.contracts.entryPoint,
    );
    return this.bundler.waitForUserOp(userOpHash);
  }

  /**
   * Request a Mode B (sponsored / gasless) allowlist token for a smart account
   * from the paymaster-service. Returns null if the account is not eligible
   * (e.g. no .qie domain and not manually allowlisted) or the service is down.
   */
  async getAllowlistToken(smartAccountAddress: Address): Promise<AllowlistToken | null> {
    try {
      const res = await fetch(`${this.config.paymasterServiceUrl}/allowlist-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: smartAccountAddress }),
      });
      if (!res.ok) return null;
      const token = (await res.json()) as AllowlistToken;
      if (typeof token.expiry !== "number" || typeof token.signature !== "string") {
        return null;
      }
      return token;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  async resolve(recipient: string): Promise<Address | null> {
    return resolveRecipient(
      this.publicClient,
      this.config.contracts,
      recipient,
      this.qieDomainConfig.registry,
    );
  }

  /**
   * Resolve a recipient into a typed, source-tagged result (address /
   * `name.qie` / username). Use this for agent and policy flows that need to
   * know HOW a recipient resolved and whether it was verified. `.qie` forward
   * resolution is only attempted when a resolver is configured — otherwise a
   * clean "resolver not configured" failure is returned (never a fabricated
   * address).
   */
  async resolveDetailed(recipient: string): Promise<ResolveRecipientResult> {
    return resolveRecipientDetailed(recipient, {
      client: this.publicClient,
      contracts: this.config.contracts,
      domainConfig: this.qieDomainConfig,
      adapter: this.resolverAdapter,
    });
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------

  async pay(signer: QevieSigner, params: PayParams): Promise<UserOpResult> {
    const acc = this.account(signer);
    const { callData, mode } = await this._buildPay(params);
    return this._submitOp(acc, callData, mode, params.allowlistToken);
  }

  /**
   * Submit a payment and return the userOpHash as soon as the bundler accepts
   * it (after validation), WITHOUT waiting for on-chain inclusion. Lets the UI
   * confirm fast and reconcile the final receipt in the background via
   * `client.bundler.waitForUserOp(hash)`.
   */
  async paySubmit(signer: QevieSigner, params: PayParams): Promise<Hex> {
    const acc = this.account(signer);
    const { callData, mode } = await this._buildPay(params);
    return this._submitOpNoWait(acc, callData, mode, params.allowlistToken);
  }

  private async _buildPay(params: PayParams): Promise<{ callData: Hex; mode: GasMode }> {
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
    return { callData, mode };
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

  async payRequest(signer: QevieSigner, params: PayRequestParams): Promise<UserOpResult> {
    const userOpHash = await this.payRequestSubmit(signer, params);
    return this.bundler.waitForUserOp(userOpHash);
  }

  async payRequestSubmit(signer: QevieSigner, params: PayRequestParams): Promise<Hex> {
    const acc = this.account(signer);
    const mode = params.mode ?? "qusdc";

    const payCallData = encodeFunctionData({
      abi: PAYMENT_REQUEST_ABI,
      functionName: "payRequest",
      args: [params.requestId],
    });

    const callData = this._encodeExecute(
      this.config.contracts.paymentRequest,
      0n,
      payCallData,
    );
    return this._submitOpNoWait(acc, callData, mode, params.allowlistToken);
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
    const smartAccount = await acc.getAddress();
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
    // Username registration is usually a brand-new account's first action, so
    // prefer sponsored (gasless) mode; fall back to QUSDC-pay if not eligible.
    const token = await this.getAllowlistToken(smartAccount);
    const mode: GasMode = token !== null ? "sponsored" : "qusdc";
    const userOpHash = await this._submitOpNoWait(acc, callData, mode, token ?? undefined);

    // Voltaire on QIE can accept and mine the UserOperation before its receipt
    // indexer returns data. Username registration has a direct on-chain success
    // signal, so use the registry as confirmation instead of blocking on the
    // bundler receipt endpoint.
    const confirmed = await this._waitForRegisteredUsername(smartAccount, username);
    if (confirmed) {
      return { userOpHash, txHash: null, status: "mined", blockNumber: null };
    }

    return this.bundler.waitForUserOp(userOpHash, 10, 2000);
  }

  // ---------------------------------------------------------------------------
  // Gas quoting
  // ---------------------------------------------------------------------------

  async quoteGas(
    signer: QevieSigner,
    mode: GasMode,
    _allowlistToken?: AllowlistToken,
  ): Promise<GasQuote> {
    void _allowlistToken;
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
  // Receipts / Passport
  // ---------------------------------------------------------------------------

  async createReceipt(input: CreateReceiptInput): Promise<CreateReceiptResult> {
    this._requireReceiptRegistry();
    const metadataHash = hashReceiptMetadata(input.metadata);
    const res = await fetch(`${this.config.paymasterServiceUrl}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        metadataHash,
      }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw new Error(
        typeof body?.error === "string" ? body.error : `Receipt creation failed (${res.status})`,
      );
    }
    return await res.json() as CreateReceiptResult;
  }

  async getReceipt(receiptId: Hex): Promise<QevieReceipt> {
    const registry = this._requireReceiptRegistry();
    const result = await this.publicClient.readContract({
      address: registry,
      abi: RECEIPT_REGISTRY_ABI,
      functionName: "getReceipt",
      args: [receiptId],
    }) as {
      receiptId: Hex;
      payer: Address;
      payee: Address;
      token: Address;
      amount: bigint;
      amountPrivate: boolean;
      metadataHash: Hex;
      paymentReference: Hex;
      receiptType: number;
      timestamp: bigint;
      issuer: Address;
    };
    return this._mapReceipt(result);
  }

  async listByPayer(account: Address): Promise<QevieReceipt[]> {
    const registry = this._requireReceiptRegistry();
    const ids = await this.publicClient.readContract({
      address: registry,
      abi: RECEIPT_REGISTRY_ABI,
      functionName: "getReceiptsByPayer",
      args: [account],
    }) as Hex[];
    return this._getReceiptsByIds(ids);
  }

  async listByPayee(account: Address): Promise<QevieReceipt[]> {
    const registry = this._requireReceiptRegistry();
    const ids = await this.publicClient.readContract({
      address: registry,
      abi: RECEIPT_REGISTRY_ABI,
      functionName: "getReceiptsByPayee",
      args: [account],
    }) as Hex[];
    return this._getReceiptsByIds(ids);
  }

  async listForAccount(account: Address): Promise<QevieReceipt[]> {
    const [payerReceipts, payeeReceipts] = await Promise.all([
      this.listByPayer(account),
      this.listByPayee(account),
    ]);
    const seen = new Set<Hex>();
    return [...payerReceipts, ...payeeReceipts]
      .filter((receipt) => {
        if (seen.has(receipt.receiptId)) return false;
        seen.add(receipt.receiptId);
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async exportReceipt(receiptId: Hex): Promise<string> {
    const receipt = await this.getReceipt(receiptId);
    const registry = this._requireReceiptRegistry();
    return JSON.stringify({
      app: "Qevie",
      network: this.config.chainId === 1990 ? "QIE Mainnet" : "QIE Testnet",
      chainId: this.config.chainId,
      receiptId: receipt.receiptId,
      receiptType: receipt.receiptType,
      payer: receipt.payer,
      payee: receipt.payee,
      token: receipt.token,
      tokenSymbol: receipt.tokenSymbol,
      amount: receipt.amountPrivate ? null : receipt.amount,
      amountPrivate: receipt.amountPrivate,
      metadataHash: receipt.metadataHash,
      txHash: receipt.paymentReference ?? null,
      timestamp: new Date(receipt.timestamp * 1000).toISOString(),
      verification: {
        source: "ReceiptRegistry",
        status: "verified",
        registry,
      },
    }, null, 2);
  }

  async getPassport(account: Address): Promise<PassportStats> {
    const receipts = await this.listForAccount(account);
    return this._aggregatePassport(account, receipts);
  }

  async getStats(account: Address): Promise<PassportStats> {
    return this.getPassport(account);
  }

  async getRecentReceipts(account: Address, limit = 10): Promise<QevieReceipt[]> {
    const receipts = await this.listForAccount(account);
    return receipts.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async _submitOpNoWait(
    acc: QevieAccount,
    callData: Hex,
    mode: GasMode,
    allowlistToken?: AllowlistToken,
    gasConfig = DEFAULT_GAS,
  ): Promise<Hex> {
    const op = await acc.buildAndSign(callData, mode, gasConfig, allowlistToken);
    return this.bundler.sendUserOperation(op, this.config.contracts.entryPoint);
  }

  private async _submitOp(
    acc: QevieAccount,
    callData: Hex,
    mode: GasMode,
    allowlistToken?: AllowlistToken,
  ): Promise<UserOpResult> {
    const userOpHash = await this._submitOpNoWait(acc, callData, mode, allowlistToken);
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

  private _requireAgentPolicyManager(): Address {
    const manager = this.config.contracts.agentPolicyManager;
    if (manager === undefined) {
      throw new Error("AgentPolicyManager is not configured for this chain.");
    }
    return manager;
  }

  private async _waitForRegisteredUsername(
    account: Address,
    username: string,
    maxAttempts = 30,
    intervalMs = 2000,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      const stored = await this.publicClient.readContract({
        address: this.config.contracts.usernameRegistry,
        abi: USERNAME_REGISTRY_ABI,
        functionName: "reverseResolve",
        args: [account],
      }) as string;

      if (stored === username) return true;
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return false;
  }

  private _memoToBytes32(memo: string): Hex {
    const encoded = new TextEncoder().encode(memo.slice(0, 31));
    const padded = new Uint8Array(32);
    padded.set(encoded);
    return `0x${Buffer.from(padded).toString("hex")}` as Hex;
  }

  private _requireReceiptRegistry(): Address {
    const receiptRegistry = this.config.contracts.receiptRegistry;
    if (receiptRegistry === undefined) {
      throw new Error("ReceiptRegistry is not configured for this network");
    }
    return receiptRegistry;
  }

  private async _getReceiptsByIds(ids: Hex[]): Promise<QevieReceipt[]> {
    const receipts = await Promise.all(ids.map((id) => this.getReceipt(id)));
    return receipts.sort((a, b) => b.timestamp - a.timestamp);
  }

  private _mapReceipt(receipt: {
    receiptId: Hex;
    payer: Address;
    payee: Address;
    token: Address;
    amount: bigint;
    amountPrivate: boolean;
    metadataHash: Hex;
    paymentReference: Hex;
    receiptType: number;
    timestamp: bigint;
    issuer: Address;
  }): QevieReceipt {
    const type = receiptTypeFromIndex(receipt.receiptType);
    return {
      receiptId: receipt.receiptId,
      payer: receipt.payer,
      payee: receipt.payee,
      token: receipt.token,
      tokenSymbol: "QUSDC",
      amount: receipt.amountPrivate ? null : formatTokenAmount(receipt.amount),
      amountPrivate: receipt.amountPrivate,
      metadataHash: receipt.metadataHash,
      receiptType: type,
      timestamp: Number(receipt.timestamp),
      issuer: receipt.issuer,
      ...(receipt.paymentReference === zeroHash ? {} : { paymentReference: receipt.paymentReference }),
    };
  }

  private _aggregatePassport(account: Address, receipts: QevieReceipt[]): PassportStats {
    let paymentsSent = 0;
    let paymentsReceived = 0;
    let subscriptionsCompleted = 0;
    let batchPayoutsSent = 0;
    let merchantReceiptsReceived = 0;
    let volumeSent = 0;
    let volumeReceived = 0;
    let volumePrivate = false;

    for (const receipt of receipts) {
      const isPayer = receipt.payer.toLowerCase() === account.toLowerCase();
      const isPayee = receipt.payee.toLowerCase() === account.toLowerCase();
      if (isPayer) paymentsSent += 1;
      if (isPayee) paymentsReceived += 1;
      if (isPayee && receipt.receiptType === "MERCHANT_CHECKOUT") merchantReceiptsReceived += 1;
      if (isPayer && receipt.receiptType === "BATCH_PAYMENT") batchPayoutsSent += 1;
      if (receipt.receiptType === "SUBSCRIPTION_PAYMENT") subscriptionsCompleted += 1;

      if (receipt.amount === null) {
        volumePrivate = true;
      } else {
        const amount = Number(receipt.amount);
        if (isPayer) volumeSent += amount;
        if (isPayee) volumeReceived += amount;
      }
    }

    return {
      account,
      totalReceipts: receipts.length,
      paymentsSent,
      paymentsReceived,
      subscriptionsCompleted,
      batchPayoutsSent,
      merchantReceiptsReceived,
      volumePrivate,
      latestReceipts: receipts.slice(0, 10),
      ...(volumePrivate ? {} : {
        qusdcVolumeSent: volumeSent.toFixed(2),
        qusdcVolumeReceived: volumeReceived.toFixed(2),
      }),
    };
  }
}

/**
 * Derive a QIE Domain config from contract addresses when none is passed
 * explicitly. Forward resolution is only enabled when a resolver address is
 * present; otherwise reverse verification still works if a registry is set.
 */
function deriveQieDomainConfig(config: QevieClientConfig): QieDomainConfig {
  const registry = config.contracts.qieDomainRegistry;
  const resolver = config.contracts.qieDomainResolver;
  return {
    enabled: resolver !== undefined || registry !== undefined,
    ...(resolver !== undefined ? { resolver } : {}),
    ...(registry !== undefined ? { registry } : {}),
    // A configured registry means the canonical QIE Domains domainInfo() method
    // is available; an explicit forward resolver uses the ENS-like probe.
    resolverType: resolver !== undefined ? "ens_like" : registry !== undefined ? "qie_domains" : "disabled",
  };
}

const zeroHash = `0x${"0".repeat(64)}` as Hex;

function formatTokenAmount(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(2);
}

function receiptTypeFromIndex(index: number): ReceiptType {
  const types: ReceiptType[] = [
    "SINGLE_PAYMENT",
    "BATCH_PAYMENT",
    "PAYMENT_REQUEST_SETTLED",
    "SUBSCRIPTION_PAYMENT",
    "MERCHANT_CHECKOUT",
    "MANUAL_RECEIPT",
  ];
  return types[index] ?? "MANUAL_RECEIPT";
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return await res.json() as { error?: string };
  } catch {
    return null;
  }
}
