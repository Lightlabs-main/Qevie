/** Measure eth_getUserOperationReceipt latency after the log-range fix. */
import { createPublicClient, http, encodeFunctionData, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQevieClient, TESTNET_CONTRACTS } from "@qevie/sdk";

const RPC = "https://rpc1testnet.qie.digital/";
const BUNDLER = "https://qevie.duckdns.org/bundler/rpc";
const PMSVC = "https://qevie.duckdns.org/paymaster";
const EP = TESTNET_CONTRACTS.entryPoint, QUSDC = TESTNET_CONTRACTS.qusdc;
const GAS = { callGasLimit: 350_000n, verificationGasLimit: 3_000_000n, preVerificationGas: 120_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, paymasterVerificationGasLimit: 200_000n, paymasterPostOpGasLimit: 100_000n };
const erc20 = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const execAbi = parseAbi(["function execute(address,uint256,bytes) returns (bytes)"]);

function signerFrom(pk: Hex) {
  const a = privateKeyToAccount(pk);
  return { address: a.address, getAddress: async () => a.address, signMessage: async (m: Uint8Array | string): Promise<Hex> => a.signMessage({ message: { raw: (typeof m === "string" ? m : `0x${Buffer.from(m).toString("hex")}`) as Hex } }) };
}

async function rawReceipt(hash: Hex): Promise<unknown> {
  const r = await fetch(BUNDLER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [hash] }) });
  return (await r.json() as { result?: unknown }).result ?? null;
}

async function main(): Promise<void> {
  const owner = signerFrom(generatePrivateKey());
  const client = createQevieClient({ chainId: 1983, rpcUrl: RPC, bundlerUrl: BUNDLER, paymasterServiceUrl: PMSVC, contracts: TESTNET_CONTRACTS });
  const pub = createPublicClient({ transport: http(RPC) });
  const smart = await client.getSmartAccountAddress(owner);
  const acc = client.account(owner);
  const mintData = encodeFunctionData({ abi: erc20, functionName: "mint", args: [smart, 1_000_000n] });
  const execMint = encodeFunctionData({ abi: execAbi, functionName: "execute", args: [QUSDC, 0n, mintData] });
  const token = await client.getAllowlistToken(smart);
  const op = await acc.buildAndSign(execMint, "sponsored", GAS, token ?? undefined);
  const t0 = Date.now();
  const hash = await client.bundler.sendUserOperation(op, EP);
  console.log("submitted:", hash);
  let minedAt = 0, receiptAt = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    const bal = await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [smart] }) as bigint;
    if (bal > 0n && minedAt === 0) minedAt = Date.now();
    const rec = await rawReceipt(hash);
    if (rec !== null && receiptAt === 0) receiptAt = Date.now();
    console.log(`t+${el}s mined=${bal > 0n} receipt=${rec !== null ? "YES" : "null"}`);
    if (rec !== null) break;
  }
  console.log(`\nmint mined at  ~t+${((minedAt - t0) / 1000).toFixed(0)}s`);
  console.log(`receipt returned at ~t+${receiptAt ? ((receiptAt - t0) / 1000).toFixed(0) : "NEVER"}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
