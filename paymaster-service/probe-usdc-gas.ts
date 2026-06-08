/**
 * E2E proof of the QUSDC_GAS path against the live bundler + new paymaster:
 *   1. Fresh account; mint test-QUSDC (sponsored, also deploys it).
 *   2. Arm: approve the paymaster for QUSDC (sponsored).
 *   3. Pay in QUSDC_GAS mode (mode "qusdc") — paymaster fronts QIE gas and
 *      charges the user QUSDC. Verify the user's QUSDC dropped by amount + gas.
 */
import { createPublicClient, http, encodeFunctionData, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQevieClient, TESTNET_CONTRACTS } from "@qevie/sdk";

const RPC = "https://rpc1testnet.qie.digital/";
const BUNDLER = "https://qevie.duckdns.org/bundler/rpc";
const PMSVC = "https://qevie.duckdns.org/paymaster";
const QUSDC = TESTNET_CONTRACTS.qusdc;
const PM = TESTNET_CONTRACTS.paymaster;

const erc20 = parseAbi([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const execAbi = parseAbi(["function execute(address,uint256,bytes) returns (bytes)"]);

function signerFrom(pk: Hex) {
  const a = privateKeyToAccount(pk);
  return {
    address: a.address,
    getAddress: async () => a.address,
    signMessage: async (m: Uint8Array | string): Promise<Hex> =>
      a.signMessage({ message: { raw: (typeof m === "string" ? m : `0x${Buffer.from(m).toString("hex")}`) as Hex } }),
  };
}

function fmt(v: bigint): string { return (Number(v) / 1e6).toFixed(6); }

async function main(): Promise<void> {
  const owner = signerFrom(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const client = createQevieClient({ chainId: 1983, rpcUrl: RPC, bundlerUrl: BUNDLER, paymasterServiceUrl: PMSVC, contracts: TESTNET_CONTRACTS });
  const pub = createPublicClient({ transport: http(RPC) });
  const smart = await client.getSmartAccountAddress(owner);
  const acc = client.account(owner);
  console.log("smart:", smart);

  // 1. Mint 5 QUSDC (sponsored op, deploys account)
  const mintData = encodeFunctionData({ abi: erc20, functionName: "mint", args: [smart, 5_000_000n] });
  const execMint = encodeFunctionData({ abi: execAbi, functionName: "execute", args: [QUSDC, 0n, mintData] });
  const token1 = await client.getAllowlistToken(smart);
  const op1 = await acc.buildAndSign(execMint, "sponsored", undefined, token1 ?? undefined);
  const h1 = await client.bundler.sendUserOperation(op1, TESTNET_CONTRACTS.entryPoint);
  const r1 = await client.bundler.waitForUserOp(h1);
  console.log("[1] mint:", r1.status, "balance:", fmt(await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [smart] }) as bigint));

  // 2. Arm: approve paymaster for QUSDC (sponsored)
  const arm = await client.ensureQusdcGasReady(owner);
  console.log("[2] arm:", arm, "allowance:", (await pub.readContract({ address: QUSDC, abi: erc20, functionName: "allowance", args: [smart, PM] }) as bigint) > 0n ? "set" : "none");

  // 3. Pay 1 QUSDC in QUSDC_GAS mode (force mode "qusdc")
  const before = await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [smart] }) as bigint;
  const res = await client.pay(owner, { to: recipient, amount: 1_000_000n, mode: "qusdc" });
  const after = await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [smart] }) as bigint;
  const recvBal = await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [recipient] }) as bigint;
  console.log("[3] qusdc-gas pay:", res.status, "tx:", res.txHash);
  console.log("    sender QUSDC:", fmt(before), "->", fmt(after), "(spent", fmt(before - after) + ")");
  console.log("    recipient got:", fmt(recvBal));
  const gasPaidInUsdc = before - after - 1_000_000n;
  console.log("    => gas charged in USDC:", fmt(gasPaidInUsdc), gasPaidInUsdc > 0n ? "✅ USER PAID GAS IN USDC" : "❌ no gas charged");
}

main().catch((e) => { console.error(e); process.exit(1); });
