import { type Address, isAddress } from "viem";
import { APP_CONFIG } from "../config.js";

/**
 * Provision a server-custodied Autopilot session key for a smart account.
 *
 * The paymaster-service mints the keypair, stores the private key encrypted, and
 * returns only the public address — so the user never has to generate or handle
 * a key. The returned address goes straight into the policy; the executor signs
 * autonomous payments with the matching private key, bounded by the policy caps.
 */
export async function provisionSessionKey(smartAccount: Address): Promise<Address> {
  const response = await fetch(`${APP_CONFIG.paymasterServiceUrl}/session-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smartAccount }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    sessionKey?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? "Could not set up Autopilot. Please try again.");
  }
  if (typeof data.sessionKey !== "string" || !isAddress(data.sessionKey)) {
    throw new Error("Autopilot service returned an invalid session key.");
  }
  return data.sessionKey;
}
