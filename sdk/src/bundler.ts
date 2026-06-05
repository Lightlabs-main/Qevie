import type { Hex } from "viem";
import type { UserOpResult } from "./types.js";
import type { PackedUserOp } from "./userop.js";

export type { PackedUserOp };

interface BundlerError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T> {
  id: number;
  jsonrpc: "2.0";
  result?: T;
  error?: BundlerError;
}

/** ERC-4337 v0.7 UserOperation in the unpacked shape bundlers expect over JSON-RPC. */
interface RpcUserOp {
  sender: Hex;
  nonce: Hex;
  factory: Hex | null;
  factoryData: Hex | null;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster: Hex | null;
  paymasterVerificationGasLimit: Hex | null;
  paymasterPostOpGasLimit: Hex | null;
  paymasterData: Hex | null;
  signature: Hex;
}

const quantity = (v: bigint): Hex => `0x${v.toString(16)}`;

/**
 * Convert a PackedUserOp (on-chain EntryPoint v0.7 struct) into the unpacked
 * shape required by the bundler JSON-RPC API. The signing hash is computed
 * over the packed struct, so this is purely the inverse packing for transport.
 */
function toRpcUserOp(op: PackedUserOp): RpcUserOp {
  const agl = op.accountGasLimits.slice(2);
  const verificationGasLimit = BigInt(`0x${agl.slice(0, 32)}`);
  const callGasLimit = BigInt(`0x${agl.slice(32, 64)}`);

  const gf = op.gasFees.slice(2);
  const maxPriorityFeePerGas = BigInt(`0x${gf.slice(0, 32)}`);
  const maxFeePerGas = BigInt(`0x${gf.slice(32, 64)}`);

  let factory: Hex | null = null;
  let factoryData: Hex | null = null;
  if (op.initCode.length > 2) {
    const ic = op.initCode.slice(2);
    factory = `0x${ic.slice(0, 40)}`;
    factoryData = `0x${ic.slice(40)}`;
  }

  let paymaster: Hex | null = null;
  let paymasterVerificationGasLimit: Hex | null = null;
  let paymasterPostOpGasLimit: Hex | null = null;
  let paymasterData: Hex | null = null;
  if (op.paymasterAndData.length > 2) {
    const pad = op.paymasterAndData.slice(2);
    paymaster = `0x${pad.slice(0, 40)}`;
    paymasterVerificationGasLimit = quantity(BigInt(`0x${pad.slice(40, 72)}`));
    paymasterPostOpGasLimit = quantity(BigInt(`0x${pad.slice(72, 104)}`));
    paymasterData = `0x${pad.slice(104)}`;
  }

  return {
    sender: op.sender,
    nonce: quantity(op.nonce),
    factory,
    factoryData,
    callData: op.callData,
    callGasLimit: quantity(callGasLimit),
    verificationGasLimit: quantity(verificationGasLimit),
    preVerificationGas: quantity(op.preVerificationGas),
    maxFeePerGas: quantity(maxFeePerGas),
    maxPriorityFeePerGas: quantity(maxPriorityFeePerGas),
    paymaster,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    paymasterData,
    signature: op.signature,
  };
}

/** Minimal ERC-4337 bundler JSON-RPC client. */
export class BundlerClient {
  private readonly url: string;
  private id = 1;

  constructor(url: string) {
    this.url = url;
  }

  /** Submit a UserOperation to the bundler. Returns the userOpHash. */
  async sendUserOperation(op: PackedUserOp, entryPoint: string): Promise<Hex> {
    const opForRpc = toRpcUserOp(op);
    const result = await this._rpc<Hex>("eth_sendUserOperation", [opForRpc, entryPoint]);
    return result;
  }

  /** Poll for a UserOperation receipt. Returns null if not yet mined. */
  async getUserOperationReceipt(userOpHash: Hex): Promise<UserOpResult | null> {
    try {
      const receipt = await this._rpc<{
        userOpHash: Hex;
        receipt: { transactionHash: Hex; blockNumber: Hex };
        success: boolean;
      } | null>("eth_getUserOperationReceipt", [userOpHash]);

      if (receipt === null) {
        return { userOpHash, txHash: null, status: "pending", blockNumber: null };
      }

      return {
        userOpHash,
        txHash: receipt.receipt.transactionHash,
        status: receipt.success ? "mined" : "failed",
        blockNumber: BigInt(receipt.receipt.blockNumber),
      };
    } catch {
      return { userOpHash, txHash: null, status: "pending", blockNumber: null };
    }
  }

  /** Wait for a UserOperation to be mined, polling up to maxAttempts times. */
  async waitForUserOp(
    userOpHash: Hex,
    maxAttempts = 40,
    intervalMs = 800,
  ): Promise<UserOpResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const receipt = await this.getUserOperationReceipt(userOpHash);
      if (receipt !== null && receipt.status !== "pending") {
        return receipt;
      }
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return { userOpHash, txHash: null, status: "failed", blockNumber: null };
  }

  private async _rpc<T>(method: string, params: unknown[]): Promise<T> {
    const requestId = this.id++;
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: requestId,
        jsonrpc: "2.0",
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Bundler HTTP error: ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    if (json.error !== undefined) {
      throw new Error(`Bundler RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result as T;
  }
}
