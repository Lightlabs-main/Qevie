import type { Address } from "viem";
import type { GasMode, AllowlistToken } from "@qevie/sdk";

/**
 * Minimal structural type for the client. Typed on just the method we need so
 * it accepts the client instance regardless of which bundled copy of the
 * QevieClient class type it came from (`@qevie/sdk` vs `@qevie/sdk/react`).
 */
interface TokenFetcher {
  getAllowlistToken(smartAddress: Address): Promise<AllowlistToken | null>;
}

/**
 * Resolve the gas params for a payment. Prefers Mode B (sponsored / fully
 * gasless) by requesting an allowlist token from the paymaster-service; falls
 * back to Mode A (pay gas in QUSDC) when the account is not eligible for the
 * sponsored free tier.
 */
export async function gaslessParams(
  client: TokenFetcher,
  smartAddress: Address,
): Promise<{ mode: GasMode; allowlistToken?: AllowlistToken }> {
  const token = await client.getAllowlistToken(smartAddress);
  return token !== null
    ? { mode: "sponsored", allowlistToken: token }
    : { mode: "qusdc" };
}
