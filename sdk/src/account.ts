import {
  type Address,
  type Hex,
  encodeFunctionData,
  getAddress,
  type PublicClient,
} from "viem";
import {
  ACCOUNT_FACTORY_ABI,
  ENTRY_POINT_ABI,
  PAYMASTER_ABI,
} from "./abis.js";
import type { QevieContracts } from "./contracts.js";
import type { GasMode, GasQuote, QevieSigner, AllowlistToken } from "./types.js";
import {
  type PackedUserOp,
  type GasConfig,
  DEFAULT_GAS,
  packAccountGasLimits,
  packGasFees,
  hashUserOp,
  buildModeAPaymasterData,
  buildModeBPaymasterData,
} from "./userop.js";

// Use a loose public client type to avoid viem's strict account-field variance checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

export class QevieAccount {
  readonly signer: QevieSigner;
  readonly publicClient: AnyPublicClient;
  readonly contracts: QevieContracts;
  readonly chainId: number;
  readonly salt: bigint;

  /** Counterfactual smart account address (may not be deployed yet). */
  address: Address | null = null;

  constructor(
    signer: QevieSigner,
    publicClient: AnyPublicClient,
    contracts: QevieContracts,
    chainId: number,
    salt: bigint = 0n,
  ) {
    this.signer = signer;
    this.publicClient = publicClient;
    this.contracts = contracts;
    this.chainId = chainId;
    this.salt = salt;
  }

  /** Compute (and cache) the counterfactual smart account address. */
  async getAddress(): Promise<Address> {
    if (this.address !== null) return this.address;

    const signerAddress = await this.signer.getAddress();
    const predicted = await this.publicClient.readContract({
      address: this.contracts.accountFactory,
      abi: ACCOUNT_FACTORY_ABI,
      functionName: "getAddress",
      args: [signerAddress, this.salt],
    }) as Address;

    this.address = getAddress(predicted);
    return this.address;
  }

  /** Return true if the smart account is already deployed on-chain. */
  async isDeployed(): Promise<boolean> {
    const addr = await this.getAddress();
    const code = await this.publicClient.getCode({ address: addr });
    return code !== undefined && code !== "0x";
  }

  /** Return the factory initCode for deploying on the first UserOperation. */
  async getInitCode(): Promise<Hex> {
    if (await this.isDeployed()) return "0x";

    const signerAddress = await this.signer.getAddress();
    const deployCallData = encodeFunctionData({
      abi: ACCOUNT_FACTORY_ABI,
      functionName: "createAccount",
      args: [signerAddress, this.salt],
    });

    return `${this.contracts.accountFactory}${deployCallData.slice(2)}` as Hex;
  }

  /** Fetch the current ERC-4337 nonce for this smart account. */
  async getNonce(): Promise<bigint> {
    const addr = await this.getAddress();
    return this.publicClient.readContract({
      address: this.contracts.entryPoint,
      abi: ENTRY_POINT_ABI,
      functionName: "getNonce",
      args: [addr, 0n],
    }) as Promise<bigint>;
  }

  /** Quote gas costs for a UserOperation before submitting. */
  async quoteGas(
    mode: GasMode,
    gasConfig: GasConfig = DEFAULT_GAS,
  ): Promise<GasQuote> {
    const addr = await this.getAddress();

    if (mode === "sponsored") {
      const remaining = await this.publicClient.readContract({
        address: this.contracts.paymaster,
        abi: PAYMASTER_ABI,
        functionName: "remainingFreeOps",
        args: [addr],
      }) as bigint;
      return {
        mode: "sponsored",
        qusdcCost: 0n,
        label: remaining > 0n ? `Free (${remaining} remaining)` : "Sponsored tier exhausted",
        freeOpsRemaining: Number(remaining),
      };
    }

    const maxCost =
      (gasConfig.callGasLimit +
        gasConfig.verificationGasLimit +
        gasConfig.paymasterVerificationGasLimit +
        gasConfig.paymasterPostOpGasLimit +
        gasConfig.preVerificationGas) *
      gasConfig.maxFeePerGas;

    const qusdcCost = await this.publicClient.readContract({
      address: this.contracts.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "quoteQUSDC",
      args: [maxCost],
    }) as bigint;

    const usdAmount = Number(qusdcCost) / 1e6;
    return {
      mode: "qusdc",
      qusdcCost,
      label: `~$${usdAmount.toFixed(4)} QUSDC`,
    };
  }

  /** Build and sign a UserOperation. */
  async buildAndSign(
    callData: Hex,
    mode: GasMode,
    gasConfig: GasConfig = DEFAULT_GAS,
    allowlistToken?: AllowlistToken,
  ): Promise<PackedUserOp> {
    const [addr, nonce, initCode] = await Promise.all([
      this.getAddress(),
      this.getNonce(),
      this.getInitCode(),
    ]);

    let paymasterAndData: Hex;
    if (mode === "sponsored") {
      if (allowlistToken === undefined) {
        throw new Error("Allowlist token required for sponsored mode");
      }
      paymasterAndData = buildModeBPaymasterData(
        this.contracts.paymaster,
        gasConfig,
        allowlistToken,
      );
    } else {
      paymasterAndData = buildModeAPaymasterData(this.contracts.paymaster, gasConfig);
    }

    const op: PackedUserOp = {
      sender: addr,
      nonce,
      initCode,
      callData,
      accountGasLimits: packAccountGasLimits(
        gasConfig.verificationGasLimit,
        gasConfig.callGasLimit,
      ),
      preVerificationGas: gasConfig.preVerificationGas,
      gasFees: packGasFees(gasConfig.maxPriorityFeePerGas, gasConfig.maxFeePerGas),
      paymasterAndData,
      signature: "0x",
    };

    const opHash = hashUserOp(op, this.contracts.entryPoint, this.chainId);
    const rawSig = await this.signer.signMessage(opHash);
    op.signature = rawSig;

    return op;
  }
}
