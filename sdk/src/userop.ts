import {
  type Address,
  type Hex,
  encodePacked,
  concat,
  toHex,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
} from "viem";
import type { AllowlistToken } from "./types.js";

// ---------------------------------------------------------------------------
// ERC-4337 v0.7 UserOperation helpers
// ---------------------------------------------------------------------------

export interface PackedUserOp {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

export interface GasConfig {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

const DEFAULT_GAS: GasConfig = {
  callGasLimit: 200_000n,
  // High enough to cover first-time account deployment via the factory (~800k gas),
  // which EntryPoint v0.7 charges against verificationGasLimit. Unused gas is not
  // billed, so this is safe for subsequent ops on an already-deployed account.
  verificationGasLimit: 3_000_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 1_000_000_000n, // 1 gwei
  maxPriorityFeePerGas: 1_000_000_000n,
  paymasterVerificationGasLimit: 200_000n,
  paymasterPostOpGasLimit: 100_000n,
};

/** Pack verificationGasLimit + callGasLimit into a single bytes32 (ERC-4337 v0.7 format). */
export function packAccountGasLimits(
  verificationGasLimit: bigint,
  callGasLimit: bigint,
): Hex {
  return toHex(
    (verificationGasLimit << 128n) | callGasLimit,
    { size: 32 },
  );
}

/** Pack maxPriorityFeePerGas + maxFeePerGas into a single bytes32. */
export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): Hex {
  return toHex(
    (maxPriorityFeePerGas << 128n) | maxFeePerGas,
    { size: 32 },
  );
}

/** Build paymasterAndData for Mode A (QUSDC-pay). */
export function buildModeAPaymasterData(
  paymaster: Address,
  gas: Pick<GasConfig, "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit">,
): Hex {
  return encodePacked(
    ["address", "uint128", "uint128", "uint8"],
    [
      paymaster,
      gas.paymasterVerificationGasLimit,
      gas.paymasterPostOpGasLimit,
      0, // MODE_QUSDC
    ],
  );
}

/** Build paymasterAndData for Mode B (sponsored). */
export function buildModeBPaymasterData(
  paymaster: Address,
  gas: Pick<GasConfig, "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit">,
  token: AllowlistToken,
): Hex {
  const expiryHex = toHex(token.expiry, { size: 4 });
  return concat([
    encodePacked(
      ["address", "uint128", "uint128", "uint8"],
      [paymaster, gas.paymasterVerificationGasLimit, gas.paymasterPostOpGasLimit, 1],
    ),
    expiryHex,
    token.signature,
  ]);
}

/** Hash a UserOperation for signing per ERC-4337 v0.7. */
export function hashUserOp(op: PackedUserOp, entryPoint: Address, chainId: number): Hex {
  const packedOpHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address sender, uint256 nonce, bytes32 initCodeHash, bytes32 callDataHash, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes32 paymasterAndDataHash",
      ),
      [
        op.sender,
        op.nonce,
        keccak256(op.initCode),
        keccak256(op.callData),
        op.accountGasLimits as `0x${string}`,
        op.preVerificationGas,
        op.gasFees as `0x${string}`,
        keccak256(op.paymasterAndData),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32 opHash, address entryPoint, uint256 chainId"), [
      packedOpHash,
      entryPoint,
      BigInt(chainId),
    ]),
  );
}

export function encodeOwnerSignature(rawSignature: Hex): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint8 mode, bytes signatureData"),
    [0, rawSignature],
  );
}

export function encodeSessionSignature(
  policyId: Hex,
  sessionKey: Address,
  rawSignature: Hex,
): Hex {
  const signatureData = encodeAbiParameters(
    parseAbiParameters("bytes32 policyId, address sessionKey, bytes signature"),
    [policyId, sessionKey, rawSignature],
  );
  return encodeAbiParameters(
    parseAbiParameters("uint8 mode, bytes signatureData"),
    [1, signatureData],
  );
}

/** Build the callData for QevieSmartAccount.execute(target, value, data). */
export function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeAbiParameters(
    parseAbiParameters("bytes4 sel, address target, uint256 value, bytes data"),
    ["0xb61d27f6", target, value, data],
  ).replace("0x", "0x") as Hex;
}

/** Encode execute call for a single ERC-20 transfer. */
export function encodeQUSDCTransfer(
  qusdcAddress: Address,
  to: Address,
  amount: bigint,
): Hex {
  const transferData = encodeAbiParameters(
    parseAbiParameters("bytes4 sel, address to, uint256 amount"),
    ["0xa9059cbb", to, amount],
  );
  return encodeAbiParameters(
    parseAbiParameters("bytes4 sel, address target, uint256 value, bytes data"),
    ["0xb61d27f6", qusdcAddress, 0n, transferData],
  ) as Hex;
}

export { DEFAULT_GAS };
