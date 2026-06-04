# VERIFICATION.md

Phase 0 verification record for qevie / passpay.

Date: 2026-06-04

Rule: no contract address is usable in shipped code until it is confirmed from an official QIE source and checked on `https://mainnet.qie.digital/`.

## Sources Checked

- QIE current docs: https://docs.qie.digital/
- QIE developer docs page: https://docs.qie.digital/developer-docs
- QIE network access docs: https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet
- QIE core concepts: https://docs.qie.digital/developer-docs/core-concepts
- QIEDEX docs: https://qiedex.qie.digital/
- QIEDEX contracts: https://qiedex.qie.digital/qiedex-contracts
- QIEDEX official token list: https://qiedex.qie.digital/official-token-contract-addresses-qie-network
- QIEDEX stablecoin bridge docs: https://qiedex.qie.digital/how-to-bridge-stablecoins
- QUSDC site: https://www.stable.qie.digital/
- QIE Domains site and public app bundle: https://domains.qie.digital/
- QIE Pass site and public app bundle: https://qiepass.qie.digital/
- QIE Wallet site: https://www.qiewallet.me/
- QIE mainnet explorer API/address pages: https://mainnet.qie.digital/
- QIE testnet explorer: https://testnet.qie.digital/

Note: the prompt referenced `https://qi-blockchain.gitbook.io/qie/developer-docs`, but that URL did not load through the browser tool. `https://docs.qie.digital/` is linked from the official QIE Wallet site and contains the reachable current docs used here.

## Network Facts

| Item | Status | Verified Value | Evidence |
| --- | --- | --- | --- |
| Mainnet chain ID | Confirmed | `1990` / RPC `eth_chainId` returned `0x7c6` | QIE docs and `https://rpc1mainnet.qie.digital/` JSON-RPC |
| Mainnet RPCs | Confirmed | `https://rpc1mainnet.qie.digital/`, `https://rpc2mainnet.qie.digital/`, `https://rpc5mainnet.qie.digital/`, plus docs also list `rpc4mainnet` and `rpc3mainnet` | QIE network access docs |
| Mainnet explorer | Confirmed | `https://mainnet.qie.digital/` | QIE network access docs and explorer reachable |
| Native gas coin symbol | Needs care | Docs conflict: network access page says `QIEV3`; core concepts says coin symbol `QIE` | Use `QIE` in UX unless QIE docs clarify otherwise; record `QIEV3` as chain metadata if wallet add-chain requires it |
| Testnet chain ID | Confirmed | `1983` / RPC `eth_chainId` returned `0x7bf` | QIE docs and `https://rpc1testnet.qie.digital/` JSON-RPC |
| Testnet RPCs | Confirmed | `https://rpc1testnet.qie.digital/` through `https://rpc6testnet.qie.digital/` | QIE network access docs |
| Testnet faucet | Confirmed | `https://www.qie.digital/faucet` | QIE network access docs |
| EVM compatibility | Confirmed | QIE docs state Solidity/Ethereum tooling compatibility | QIE developer docs and core concepts |

## Mainnet Contracts And Tokens

| Component | Address | Status | Explorer Evidence | Official Source |
| --- | --- | --- | --- | --- |
| QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | Confirmed; explorer source verified; ERC-20, 6 decimals | https://mainnet.qie.digital/address/0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 | QIEDEX official token list; QUSDC site describes the asset |
| WQIE | `0x0087904D95BEe9E5F24dc8852804b547981A9139` | Confirmed contract/token on explorer; source not verified | https://mainnet.qie.digital/address/0x0087904D95BEe9E5F24dc8852804b547981A9139 | QIEDEX contracts and official token list |
| QIEDEX router | `0x08cd2e72e156D8563B4351eb4065C262A9f553Ef` | Confirmed contract on explorer; source not verified | https://mainnet.qie.digital/address/0x08cd2e72e156D8563B4351eb4065C262A9f553Ef | QIEDEX contracts |
| QIEDEX factory | `0x8E23128a5511223bE6c0d64106e2D4508C08398C` | Confirmed contract on explorer; source not verified | https://mainnet.qie.digital/address/0x8E23128a5511223bE6c0d64106e2D4508C08398C | QIEDEX contracts |
| WQIE/QUSDC pair | `0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe` | Confirmed by factory `getPair(WQIE,QUSDC)` and explorer; LP token source not verified | https://mainnet.qie.digital/address/0x73a3cCF7da7e473ed2e9994aE764f0E30F4E4dfe | Derived from verified factory call |
| QIE Domains root registry-like proxy | `0x26cCB3fABd6db18834987134d715Ba2346CE7223` | Confirmed contract; EIP-1967 proxy; source not verified | https://mainnet.qie.digital/address/0x26cCB3fABd6db18834987134d715Ba2346CE7223 | QIE Domains public app bundle |
| QIE Domains metadata resolver-like proxy | `0xCFBcBCA93c607590b211c81C7DBcdbd7eD6CC6ED` | Confirmed contract; EIP-1967 proxy; explorer source verified as proxy | https://mainnet.qie.digital/address/0xCFBcBCA93c607590b211c81C7DBcdbd7eD6CC6ED | QIE Domains public app bundle |
| `.qie` ERC-721 zone/token | `0x9aab56e7727af53A3131985BFB16d845319b7bdc` | Confirmed ERC-721 token on explorer; source not verified | https://mainnet.qie.digital/address/0x9aab56e7727af53A3131985BFB16d845319b7bdc | QIE Domains public app bundle |

## QIEDEX Price Route

The QIEDEX factory call `getPair(WQIE,QUSDC)` returned `0x73a3cCF7da7e473ed2e9994aE764f0E30F4E4dfe`.

Pair calls:

- `token0()` = `0x0087904d95bee9e5f24dc8852804b547981a9139` (WQIE)
- `token1()` = `0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5` (QUSDC)
- `getReserves()` raw values:
  - WQIE reserve: `53184375502189204069113` = about `53,184.37550218921 WQIE`
  - QUSDC reserve: `9816969580` = about `9,816.96958 QUSDC`
  - Implied spot: about `0.1845837144 QUSDC / WQIE`

Result: direct WQIE/QUSDC pricing route exists. The pool is usable for Phase 0, but paymaster implementation must use manipulation-resistant quoting, maximum slippage, stale/low-liquidity checks, and conservative markup.

## ERC-4337 EntryPoint

| Chain | Address | RPC `eth_getCode` Result | Status |
| --- | --- | --- | --- |
| Mainnet 1990 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7 canonical) | `0x` | Not deployed |
| Mainnet 1990 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` (v0.6 canonical) | `0x` | Not deployed |
| Testnet 1983 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7 canonical) | `0x` | Not deployed |
| Testnet 1983 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` (v0.6 canonical) | `0x` | Not deployed |

Decision: deploy audited eth-infinitism EntryPoint v0.7 during Phase 1, first on testnet and then on mainnet if 4337 remains the selected path.

## RPC Tracing

| RPC | Method | Result | Impact |
| --- | --- | --- | --- |
| `https://rpc1mainnet.qie.digital/` | `debug_traceCall` | Error `-32601`: method does not exist/is not available | Standard 4337 bundlers that require tracing may not work against public RPC |
| `https://rpc1testnet.qie.digital/` | `debug_traceCall` | Error `-32601`: method does not exist/is not available | Phase 1 must test bundler unsafe/no-trace mode or use a node/RPC with tracing |

Decision: keep the ERC-4337 path for now, but the GO/NO-GO checkpoint must be strict. If bundler validation is unstable without tracing, switch SDK/app transport to the EIP-2771 relayer fallback.

## QIE Domains

Official docs/pages describe `.qie` domains and the official Domains app is live. The public Domains app bundle exposes:

- Root registry-like ABI with methods including `domainInfo(string)`, `resolver(string)`, `userDomain(address)`, and `domainExist(string)`.
- Root registry-like address: `0x26cCB3fABd6db18834987134d715Ba2346CE7223`.
- Metadata resolver-like address: `0xCFBcBCA93c607590b211c81C7DBcdbd7eD6CC6ED`, with app usage of `resolveMetadata(domain, network)`.
- `.qie` ERC-721 zone/token: `0x9aab56e7727af53A3131985BFB16d845319b7bdc`.

Result: on-chain domain resolution appears usable, but the root registry source is not explorer-verified. Implement QIE Domain resolution behind an adapter and test read-only calls before using it in payment resolution or Sybil gating.

## QIE Pass

QIE Pass official site describes reusable identity/KYC and links to `https://getpass.qie.digital/auth/sign-up`, with Sumsub/QIE Wallet integration. The public QIE Pass bundle did not expose any `0x...` contract address. No on-chain QIE Pass contract or public SDK address was found in reachable docs/pages.

Result: QIE Pass on-chain gating is blocked. For sponsored free-tier Sybil resistance, use verified QIE Domain gating if the Domains adapter passes read-only tests; otherwise use a signed allowlist issued by `paymaster-service`. Do not ship an open free tier.

## QIE Wallet

Official QIE Wallet site states:

- Available on iOS, Android, and Chrome extension.
- Connects to 400+ dApps.
- Supports QIE Domains and QIE Pass.

The official QIE Domains app uses Reown/AppKit-style wallet connection and an EIP-1193 provider wrapper in its public bundle. Treat QIE Wallet support as WalletConnect/AppKit plus browser extension/injected-provider support until tested with the actual wallet.

## Blockers And Required Follow-Up

1. EntryPoint is not deployed on testnet or mainnet.
   - Safe fallback: deploy audited eth-infinitism EntryPoint v0.7 and record deployed addresses here.

2. Public QIE RPCs tested do not support `debug_traceCall`.
   - Safe fallback: test an ERC-4337 bundler in unsafe/no-trace mode; if unstable, ship the EIP-2771 trusted-forwarder relayer behind the same SDK transport interface.

3. QIE Pass has no verified on-chain contract or public SDK address from reachable sources.
   - Safe fallback: gate sponsored free tier by verified QIE Domain, or by a signed allowlist from `paymaster-service`.

4. QIEDEX router/factory/WQIE/pair are real mainnet contracts, but source is not explorer-verified except QUSDC.
   - Safe fallback: use minimal audited interfaces only, add runtime checks for factory/pair/token ordering, and keep price/manipulation guards mandatory.

## Phase 0 Outcome

QUSDC, WQIE, QIEDEX router/factory, a direct WQIE/QUSDC price route, QIE Domains on-chain contracts, chain IDs, and EntryPoint status are verified enough to continue to Phase 1.

Do not deploy application contracts to mainnet until:

- EntryPoint v0.7 is deployed/verified or a documented relayer fallback is selected.
- A bundler/no-trace decision is made at the Phase 1 GO/NO-GO checkpoint.
- QIE Domain resolution read-only calls are tested from the SDK.
- Paymaster price guards are implemented and tested against the thin WQIE/QUSDC pool.

## Phase 1 Local Progress

Date: 2026-06-04

Completed locally:

- Created pnpm workspace and Foundry `contracts/` package.
- Implemented original `QevieSmartAccount` for ERC-4337 v0.7 `PackedUserOperation`.
- Implemented original `QevieSmartAccountFactory` using CREATE2 counterfactual deployment.
- Added `DeployFactory.s.sol` script for factory deployment after EntryPoint exists.
- Added EntryPoint v0.7 deployment runbook pointing to audited eth-infinitism infrastructure.
- Added Voltaire bundler docker-compose in unsafe/no-trace test mode because QIE public RPC tracing is unavailable.
- Added architecture/security/readme docs for the Phase 1 account abstraction core.

Verification commands run:

- `pnpm -r build` passed.
- `pnpm -r test` passed: 5 Foundry tests, 0 failures.
- `pnpm -r lint` passed.
- `pnpm -r typecheck` passed.
- `rg -n "mock|stub|fake|TODO|FIXME" ...` returned only the rule text inside `AGENTS.md` and this historical verification note.

Current deployment blocker:

- EntryPoint v0.7 and the qevie factory are deployed on QIE testnet.
- A direct EntryPoint `handleOps` smoke test succeeded.
- A real bundler has not been run end-to-end yet.

Next Phase 1 action:

1. Start the Voltaire bundler in `infra/bundler`.
2. Send the same minimal UserOperation through the bundler RPC.
3. Decide the GO/NO-GO checkpoint: continue ERC-4337 if bundler submission is stable; otherwise switch to the EIP-2771 relayer fallback.

### QIE Testnet Deployments

| Component | Address | Tx Hash | Status |
| --- | --- | --- | --- |
| EntryPoint v0.7.0 | `0xa07d2Ff33400fbE2c741385cb959D5BCbA041493` | `0x4d98fcb1164b2595bf8c865fdb4e9d4a7d9e1a57c97885fa7199685813599204` | Deployed from audited eth-infinitism `account-abstraction` v0.7.0 package |
| QevieSmartAccountFactory | `0x6ed8b09371e133dab2AC87Da81615D3152092E3A` | `0x2476eda04cc7eea773ca7a0ca2be5845cb3f54e3a8321847da3ab798760bc0ea` | Deployed |

Explorer links:

- https://testnet.qie.digital/address/0xa07d2Ff33400fbE2c741385cb959D5BCbA041493
- https://testnet.qie.digital/address/0x6ed8b09371e133dab2AC87Da81615D3152092E3A

### Phase 1 UserOperation Smoke Test

Script: `contracts/script/SmokeUserOp.s.sol`

Result:

- Counterfactual account address: `0xdaa7b6259342875AC47379d208eE72F8326299fd`
- Smoke counter address: `0xd41C837e0c91024b41A2F456DF4100d0c964bBb1`
- EntryPoint deposit tx: `0x8c999068408abbcd892074648e1d819c3b83f183f325086147b02f0ceb6e5884`
- Smoke counter deployment tx: `0xdccd395a876d6f341b00ccb4bfe0824787fab39afd4ade3cd86169607041e512`
- EntryPoint `handleOps` tx: `0x7977c472c761189594b9d45ee64a696a90375eeb66a3005a53b8a775fe620f95`
- On-chain counter value after `handleOps`: `1`
- On-chain account owner: `0xfF88D1Fd6BEf257d8E76c035B6229700B23167e1`

This proves the Phase 1 AA core path on QIE testnet: EntryPoint v0.7, counterfactual account deployment via factory `initCode`, owner signature validation, and account execution through `handleOps`.

This does not yet prove paymaster-funded gasless stablecoin payment. Paymaster work starts in Phase 2.
