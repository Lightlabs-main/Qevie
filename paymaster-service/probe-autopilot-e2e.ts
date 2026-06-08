/**
 * Proof the Autopilot AGENTS are real (not mockups) and need no API key:
 *   1. Fresh account; mint 20 QUSDC (sponsored).
 *   2. Arm QUSDC-gas approval (sponsored).
 *   3. Provision a SERVER-CUSTODIED session key (POST /session-key).
 *   4. Create an on-chain policy: sponsored gas OFF, QUSDC gas ON → the agent
 *      MUST pay gas in USDC.
 *   5. Affordability agent: schedule an UNAFFORDABLE payment → expect rejection.
 *   6. Schedule an affordable one-shot intent.
 *   7. The UNATTENDED executor (server-side, no client involvement) signs with
 *      the custodied key and settles on-chain. Poll /autopilot/intents until
 *      completed, then verify the recipient was paid ON-CHAIN.
 */
import { createPublicClient, http, encodeFunctionData, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQevieClient, TESTNET_CONTRACTS } from "@qevie/sdk";

const RPC = "https://rpc1testnet.qie.digital/";
const BUNDLER = "https://qevie.duckdns.org/bundler/rpc";
const PMSVC = "https://qevie.duckdns.org/paymaster";
const QUSDC = TESTNET_CONTRACTS.qusdc;
const erc20 = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
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
const fmt = (v: bigint): string => (Number(v) / 1e6).toFixed(6);

async function main(): Promise<void> {
  const owner = signerFrom(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const client = createQevieClient({ chainId: 1983, rpcUrl: RPC, bundlerUrl: BUNDLER, paymasterServiceUrl: PMSVC, contracts: TESTNET_CONTRACTS });
  const pub = createPublicClient({ transport: http(RPC) });
  const smart = await client.getSmartAccountAddress(owner);
  const acc = client.account(owner);
  console.log("smart:", smart, "\nrecipient:", recipient);

  // 1. mint 20 QUSDC (sponsored, deploys account)
  const mintData = encodeFunctionData({ abi: erc20, functionName: "mint", args: [smart, 20_000_000n] });
  const execMint = encodeFunctionData({ abi: execAbi, functionName: "execute", args: [QUSDC, 0n, mintData] });
  const t1 = await client.getAllowlistToken(smart);
  const r1 = await client.bundler.waitForUserOp(await client.bundler.sendUserOperation(await acc.buildAndSign(execMint, "sponsored", undefined, t1 ?? undefined), TESTNET_CONTRACTS.entryPoint));
  console.log("[1] mint:", r1.status, "bal:", fmt(await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [smart] }) as bigint));

  // 2. arm qusdc-gas approval (sponsored)
  console.log("[2] arm qusdc-gas:", (await client.ensureQusdcGasReady(owner)).armed ? "armed ✅" : "FAILED");

  // 3. server-custodied session key
  const sk = (await (await fetch(`${PMSVC}/session-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smartAccount: smart }) })).json()) as { sessionKey: Hex };
  console.log("[3] session key (server-custodied):", sk.sessionKey);

  // 4. policy: sponsored OFF, qusdc ON → agent must pay gas in USDC
  const now = Math.floor(Date.now() / 1000);
  const cp = await client.agent.createSessionPolicy(owner, {
    sessionKey: sk.sessionKey, guardian: owner.address, recipients: [recipient],
    maxPerTx: 50_000_000n, dailyLimit: 50_000_000n, weeklyLimit: 50_000_000n, totalLimit: 50_000_000n,
    maxQusdcGasPerTx: 0n, dailyQusdcGasCap: 0n, validAfter: 0n, validUntil: BigInt(now + 86_400),
    allowSinglePayment: true, allowBatchPayment: false, allowPaymentRequest: false, allowSubscription: false,
    allowSponsoredGas: false, allowQusdcGas: true, allowNativeQieFallback: false, pauseWhenGasUnavailable: true,
  }, { mode: "sponsored", waitForReceipt: false });
  let active = false;
  for (let i = 0; i < 20 && !active; i++) { await new Promise((r) => setTimeout(r, 3000)); try { active = (await client.agent.getSessionPolicy(cp.policyId)).active; } catch { /* not indexed */ } }
  console.log("[4] policy active:", active, "(sponsored OFF, qusdc ON)");
  if (!active) throw new Error("policy never went active");

  // 5. affordability agent: schedule UNAFFORDABLE (30 QUSDC > 20 balance) → reject
  const bad = await fetch(`${PMSVC}/autopilot/intent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smartAccount: smart, policyId: cp.policyId, recipient, amount: "30000000", maxRuns: 1 }) });
  console.log("[5] schedule 30 QUSDC (account holds 20):", bad.status, "→", JSON.stringify(await bad.json()));

  // 6. schedule an affordable one-shot
  const ok = await fetch(`${PMSVC}/autopilot/intent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smartAccount: smart, policyId: cp.policyId, recipient, amount: "2000000", maxRuns: 1, startAt: now }) });
  const intent = (await ok.json()) as { id: string };
  console.log("[6] scheduled affordable 2 QUSDC intent:", intent.id);

  // 7. wait for the UNATTENDED executor to settle it
  console.log("[7] waiting for the unattended agent to execute (polls every 60s)...");
  let done = false, lastGasMode = "?";
  for (let i = 0; i < 60 && !done; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const list = (await (await fetch(`${PMSVC}/autopilot/intents?smartAccount=${smart}`)).json()) as { intents: { id: string; status: string; lastGasMode?: string; lastTxHash?: string }[] };
    const it = list.intents.find((x) => x.id === intent.id);
    if (it) { lastGasMode = it.lastGasMode ?? "?"; if (it.status === "completed") { done = true; console.log("    agent settled:", it.status, "gas:", it.lastGasMode, "tx:", it.lastTxHash); } }
  }
  const recvBal = await pub.readContract({ address: QUSDC, abi: erc20, functionName: "balanceOf", args: [recipient] }) as bigint;
  console.log("[7] recipient on-chain balance:", fmt(recvBal), recvBal >= 2_000_000n ? "✅ AGENT PAID THE RECIPIENT (real, unattended)" : "❌ not paid");
  console.log("    autopilot gas mode used:", lastGasMode, lastGasMode === "QUSDC_GAS" ? "✅ agent paid gas in USDC" : "");
  if (recvBal < 2_000_000n) process.exit(1);
}
main().catch((e) => { console.error("\n❌", e); process.exit(1); });
