/**
 * Live mainnet (1990) proof of sponsored onboarding through the deployed
 * EntryPoint + bundler + paymaster. A fresh account: request an allowlist
 * token, then send one sponsored UserOperation (arm QUSDC-gas approval). The
 * paymaster fronts the gas (Mode A), the account is deployed, and the user
 * pays zero QIE. No QUSDC required.
 */
import { createPublicClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQevieClient, MAINNET_CONTRACTS, type QevieContracts } from "@qevie/sdk";

const RPC = "https://rpc1mainnet.qie.digital/";
const BUNDLER = "https://qevie.duckdns.org/bundler/rpc";
const PMSVC = "https://qevie.duckdns.org/paymaster";

function signerFrom(pk: Hex) {
  const a = privateKeyToAccount(pk);
  return {
    address: a.address,
    getAddress: async () => a.address,
    signMessage: async (m: Uint8Array | string): Promise<Hex> =>
      a.signMessage({ message: { raw: (typeof m === "string" ? m : `0x${Buffer.from(m).toString("hex")}`) as Hex } }),
  };
}

async function main(): Promise<void> {
  const owner = signerFrom(generatePrivateKey());
  const client = createQevieClient({
    chainId: 1990, rpcUrl: RPC, bundlerUrl: BUNDLER, paymasterServiceUrl: PMSVC,
    contracts: MAINNET_CONTRACTS as QevieContracts,
  });
  const pub = createPublicClient({ transport: http(RPC) });
  const smart = await client.getSmartAccountAddress(owner);
  console.log("owner :", owner.address);
  console.log("smart :", smart);

  const codeBefore = await pub.getCode({ address: smart });
  console.log("deployed before:", (codeBefore?.length ?? 0) > 2);

  const token = await client.getAllowlistToken(smart);
  console.log("allowlist token:", token ? "ISSUED (sponsorship authorized)" : "DENIED");

  const arm = await client.ensureQusdcGasReady(owner);
  console.log("sponsored arm op:", JSON.stringify(arm));

  const codeAfter = await pub.getCode({ address: smart });
  console.log("deployed after :", (codeAfter?.length ?? 0) > 2,
    (codeAfter?.length ?? 0) > 2 ? "✅ SPONSORED ONBOARDING WORKED ON MAINNET" : "❌");
}

main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
