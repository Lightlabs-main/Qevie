import type { Address } from "viem";
import type { GasMode, AllowlistToken } from "@qevie/sdk";
import { PAYMASTER_ABI } from "@qevie/sdk";
import { APP_CONFIG } from "../config.js";

/**
 * Minimal structural type for the client. Typed on just the bits we need so it
 * accepts the client instance regardless of which bundled copy of the
 * QevieClient class type it came from (`@qevie/sdk` vs `@qevie/sdk/react`).
 */
interface GaslessClient {
  getAllowlistToken(smartAddress: Address): Promise<AllowlistToken | null>;
  publicClient: {
    readContract(args: unknown): Promise<unknown>;
  };
}

export interface GaslessResolution {
  mode: GasMode;
  allowlistToken?: AllowlistToken;
  /** Human-facing gas mode for the UI. */
  uiMode: "SPONSORED_ONBOARDING" | "QUSDC_GAS" | "NEEDS_QUSDC";
  /** Remaining sponsored onboarding ops (0..3). */
  sponsoredRemaining: number;
  /** Estimated QUSDC charged for gas in QUSDC_GAS mode (6-dec), if known. */
  estimatedQusdcGas?: bigint;
  /** When NEEDS_QUSDC, why the user can't pay (e.g. add QUSDC / approve). */
  reason?: string;
}

/** Worst-case gas cost (wei) to quote QUSDC gas (~600k gas @ 1 gwei). */
const MAX_GAS_COST_WEI = 600_000n * 1_000_000_000n;

async function remainingFreeOps(client: GaslessClient, smart: Address): Promise<number> {
  try {
    return Number(
      (await client.publicClient.readContract({
        address: APP_CONFIG.contracts.paymaster,
        abi: PAYMASTER_ABI,
        functionName: "remainingFreeOps",
        args: [smart],
      })) as bigint,
    );
  } catch {
    return 0;
  }
}

async function quoteQusdcGas(
  client: GaslessClient,
  smart: Address,
): Promise<{ available: boolean; quoted: bigint; reason: string }> {
  try {
    const [available, quoted, reason] = (await client.publicClient.readContract({
      address: APP_CONFIG.contracts.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "qusdcGasAvailable",
      args: [smart, MAX_GAS_COST_WEI],
    })) as [boolean, bigint, string];
    return { available, quoted, reason };
  } catch {
    return { available: false, quoted: 0n, reason: "QUSDC gas pricing unavailable" };
  }
}

/**
 * Resolve the gas params for the next payment under the Qevie gas model:
 *
 *   SPONSORED_ONBOARDING  while the account still has free onboarding ops, then
 *   QUSDC_GAS             — the user pays the network fee in QUSDC.
 *
 * Qevie is a payment app: after onboarding you pay gas in QUSDC. There is no
 * native-QIE fallback — if the user holds no QUSDC (or hasn't armed the
 * paymaster approval), `uiMode` is NEEDS_QUSDC and the caller should prompt
 * them to add/approve QUSDC.
 */
export async function gaslessParams(
  client: GaslessClient,
  smartAddress: Address,
): Promise<GaslessResolution> {
  const freeOps = await remainingFreeOps(client, smartAddress);

  if (freeOps > 0) {
    const token = await client.getAllowlistToken(smartAddress);
    if (token !== null) {
      return {
        mode: "sponsored",
        allowlistToken: token,
        uiMode: "SPONSORED_ONBOARDING",
        sponsoredRemaining: freeOps,
      };
    }
  }

  // Onboarding exhausted (or sponsorship unavailable): pay gas in QUSDC.
  const quote = await quoteQusdcGas(client, smartAddress);
  if (quote.available) {
    return {
      mode: "qusdc",
      uiMode: "QUSDC_GAS",
      sponsoredRemaining: 0,
      estimatedQusdcGas: quote.quoted,
    };
  }

  // Can't pay: the user needs QUSDC (and the paymaster approval armed).
  return {
    mode: "qusdc",
    uiMode: "NEEDS_QUSDC",
    sponsoredRemaining: 0,
    estimatedQusdcGas: quote.quoted,
    reason: quote.reason,
  };
}
