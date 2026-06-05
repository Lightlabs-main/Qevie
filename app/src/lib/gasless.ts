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

/**
 * Resolve the gas params for a payment.
 *
 * Prefers Mode B (sponsored / fully gasless) while the smart account still has
 * free sponsored ops left (the paymaster caps these at 3 per account, lifetime).
 * Once exhausted, falls back to `self` mode — the smart account pays its own gas
 * in native QIE (it must hold a little QIE; the testnet faucet drips some).
 */
export async function gaslessParams(
  client: GaslessClient,
  smartAddress: Address,
): Promise<{ mode: GasMode; allowlistToken?: AllowlistToken }> {
  let freeOps = 0;
  try {
    freeOps = Number(
      (await client.publicClient.readContract({
        address: APP_CONFIG.contracts.paymaster,
        abi: PAYMASTER_ABI,
        functionName: "remainingFreeOps",
        args: [smartAddress],
      })) as bigint,
    );
  } catch {
    /* treat as no free ops; fall through to self-paid */
  }

  if (freeOps > 0) {
    const token = await client.getAllowlistToken(smartAddress);
    if (token !== null) {
      return { mode: "sponsored", allowlistToken: token };
    }
  }

  // No sponsored ops left (or paymaster unavailable): pay gas in QIE.
  return { mode: "self" };
}
