import { decodeAbiParameters, parseAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { encodeOwnerSignature, encodeSessionSignature } from "./userop.js";

const SIGNATURE = `0x${"11".repeat(65)}` as const;
const POLICY_ID = `0x${"22".repeat(32)}` as const;
const SESSION_KEY = "0x3333333333333333333333333333333333333333";

describe("UserOperation signature envelopes", () => {
  it("encodes owner mode", () => {
    const encoded = encodeOwnerSignature(SIGNATURE);
    const [mode, signatureData] = decodeAbiParameters(
      parseAbiParameters("uint8 mode, bytes signatureData"),
      encoded,
    );
    expect(mode).toBe(0);
    expect(signatureData).toBe(SIGNATURE);
  });

  it("encodes session mode with policy binding", () => {
    const encoded = encodeSessionSignature(POLICY_ID, SESSION_KEY, SIGNATURE);
    const [mode, signatureData] = decodeAbiParameters(
      parseAbiParameters("uint8 mode, bytes signatureData"),
      encoded,
    );
    const [policyId, sessionKey, signature] = decodeAbiParameters(
      parseAbiParameters("bytes32 policyId, address sessionKey, bytes signature"),
      signatureData,
    );
    expect(mode).toBe(1);
    expect(policyId).toBe(POLICY_ID);
    expect(sessionKey.toLowerCase()).toBe(SESSION_KEY);
    expect(signature).toBe(SIGNATURE);
  });
});
