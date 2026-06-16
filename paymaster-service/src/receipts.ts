import {
  RECEIPT_REGISTRY_ABI,
  type CreateReceiptResult,
  type ReceiptType,
} from "@qevie/sdk";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  RECEIPT_ISSUER_PRIVATE_KEY,
  RECEIPT_REGISTRY_ADDRESS,
  RPC_URL,
} from "./config.js";

interface ReceiptRequestBody {
  payer: Address;
  payee: Address;
  token: Address;
  amount: string;
  amountPrivate: boolean;
  metadataHash: Hex;
  receiptType: ReceiptType;
  paymentReference?: Hex;
}

const receiptTypeIndex: Record<ReceiptType, number> = {
  SINGLE_PAYMENT: 0,
  BATCH_PAYMENT: 1,
  PAYMENT_REQUEST_SETTLED: 2,
  SUBSCRIPTION_PAYMENT: 3,
  MERCHANT_CHECKOUT: 4,
  MANUAL_RECEIPT: 5,
};

// Explicit gas limit for createReceipt. The QIE RPC's eth_estimateGas returns
// only the intrinsic cost (~21k) for this call, so without an explicit limit
// viem submits a tx with no execution gas and createReceipt reverts
// out-of-gas — the tx still "confirms" with no logs, which previously surfaced
// as the misleading "no ReceiptCreated event was found". createReceipt uses
// ~325k; 600k is a comfortable ceiling.
const RECEIPT_GAS_LIMIT = BigInt(process.env["RECEIPT_GAS_LIMIT"] ?? 600_000);

export async function issueReceipt(body: ReceiptRequestBody): Promise<CreateReceiptResult> {
  if (RECEIPT_REGISTRY_ADDRESS === undefined) {
    throw new Error("ReceiptRegistry is not configured on the service");
  }

  const account = privateKeyToAccount(RECEIPT_ISSUER_PRIVATE_KEY() as Hex);
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    transport: http(RPC_URL),
  });

  const txHash = await walletClient.sendTransaction({
    account,
    to: RECEIPT_REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: RECEIPT_REGISTRY_ABI,
      functionName: "createReceipt",
      args: [
        body.payer,
        body.payee,
        body.token,
        parseQusdc(body.amount),
        body.amountPrivate,
        body.metadataHash,
        body.paymentReference ?? zeroHash,
        receiptTypeIndex[body.receiptType],
      ],
    }),
    chain: undefined,
    gas: RECEIPT_GAS_LIMIT,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`createReceipt reverted (tx ${txHash}); no receipt was issued`);
  }
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: RECEIPT_REGISTRY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "ReceiptCreated") {
        return {
          receiptId: decoded.args.receiptId,
          metadataHash: body.metadataHash,
          txHash,
        };
      }
    } catch {
      // ignore unrelated logs
    }
  }

  throw new Error("Receipt tx confirmed but no ReceiptCreated event was found");
}

function parseQusdc(value: string): bigint {
  const [wholeRaw, fractionRaw = ""] = value.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const fraction = `${fractionRaw}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fraction);
}

const zeroHash = `0x${"0".repeat(64)}` as Hex;

void CHAIN_ID;
