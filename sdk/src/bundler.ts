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

/** Minimal ERC-4337 bundler JSON-RPC client. */
export class BundlerClient {
  private readonly url: string;
  private id = 1;

  constructor(url: string) {
    this.url = url;
  }

  /** Submit a UserOperation to the bundler. Returns the userOpHash. */
  async sendUserOperation(op: PackedUserOp, entryPoint: string): Promise<Hex> {
    const opForRpc = {
      sender: op.sender,
      nonce: `0x${op.nonce.toString(16)}`,
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: `0x${op.preVerificationGas.toString(16)}`,
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
      signature: op.signature,
    };

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
    maxAttempts = 20,
    intervalMs = 2000,
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
