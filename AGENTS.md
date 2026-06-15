# AGENTS.md — qevie / passpay

Shared conventions for any AI coding agent (Codex, Claude Code, Jules, Cursor, Aider, Zed)
working in this repo. Read this file fully before doing anything.

## What this is
Gasless stablecoin payments app on QIE mainnet (Chain ID 1990) + a TypeScript SDK.
ERC-4337 account abstraction, QUSDC settlement, recurring/batch/QR payments.
Full spec lives in the original build prompt; this file is the operating contract.

## Golden rules (never violate)
1. VERIFY BEFORE YOU CODE. No contract address is used until it is confirmed on
   https://mainnet.qie.digital/ and recorded in README.md. Never invent/guess an address.
2. REAL MAINNET, NO MOCKS in shipped paths. Mocks live only under test/. The deliverable
   runs on chain 1990 with real QUSDC and a real-QIE-funded paymaster.
3. TESTNET (1983) FOR DEV, MAINNET (1990) FOR DELIVERY.
4. PAYMASTER = REAL MONEY. Caps, Sybil-gating, scoped sponsorship, reentrancy guards. Always.
5. ORIGINAL CODE. Reference UX from external apps is fine; copying/forking code is not.
6. NO SECRETS IN GIT. Use .env (+ .env.example). Never print or commit keys.
7. If blocked, write it in README.md with the safest labeled fallback. Do not ship a fabricated value.

## Setup
- Package manager: pnpm. Install: `pnpm install`
- Build all: `pnpm -r build`
- Contracts: `cd contracts && forge build && forge test`
- Lint/format: `pnpm -r lint` / `pnpm -r format`
- Typecheck: `pnpm -r typecheck`

## Repo layout
- contracts/   Solidity (Foundry): account, paymaster, payments, subscriptions, registry
- sdk/         @qevie/sdk (framework-agnostic core + React hooks)
- app/         React PWA (consumes @qevie/sdk only)
- paymaster-service/  sponsorship API + subscription keeper + chain indexer
- infra/       bundler container, docker-compose, deploy runbooks

## Coding conventions
- TypeScript strict; no `any`; no dead/commented-out code; explicit return types on exports.
- Solidity ^0.8.24, OpenZeppelin, full NatSpec, SafeERC20, checks-effects-interactions.
- The app calls the SDK, never the chain directly. Missing capability => add to SDK, not a hack in app.
- On-chain is the source of truth for money; Supabase only stores metadata + a chain-indexed cache.

## Before you commit
- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` all green.
- `cd contracts && forge test` green (incl. adversarial paymaster tests).
- Grep for and resolve: mock|stub|fake|TODO|FIXME in non-test shipped paths.
- No secrets staged.

## Commits & handoff
- Conventional Commits (feat:, fix:, chore:, test:, docs:). Small, focused commits.
- After finishing a phase, update the Status / Handoff block below: what's done, what's next,
  any new verified addresses (also in README.md), and open blockers.

## Build order (do not reorder)
Phase 0 Verify -> Phase 1 AA core on testnet -> GO/NO-GO (4337 vs EIP-2771 fallback)
-> Phase 2 Paymaster -> Phase 3 Payment contracts -> Phase 4 SDK -> Phase 5 App
-> Phase 6 Mainnet deploy + verify -> Phase 7 Ship.

## Status / Handoff (keep current)
- Current phase: Testnet gas-mode UX rollout — live sponsored-onboarding, QUSDC-gas, and add-QUSDC states are shown across wallet and payment flows
- 4337 vs relayer decision: ERC-4337 via Voltaire unsafe/no-trace bundler (direct handleOps smoke test confirmed on testnet)
- Verified addresses: see README.md
- Open blockers: 
  - Phase 2-3 contracts not yet deployed on testnet (run DeployAll.s.sol with funded key)
  - QIE Pass on-chain gating unavailable; using QIE Domain + signed allowlist fallback
  - Autopilot service agents, audit storage, and unattended session-key orchestration are not implemented yet
  - Session-key execution is implemented in contracts and SDK but still needs a live autonomous payment smoke test through the running bundler
- What is built and tested:
  - Contracts: QevieSmartAccount, Factory, QeviePaymaster (Mode A + B), BatchPayments, 
    PaymentRequest, SubscriptionManager, UsernameRegistry, ReceiptRegistry, AgentPolicyManager, and session-key execution path — Foundry suite passing locally (72 tests)
  - SDK: @qevie/sdk core + React hooks + receipt/passport and Autopilot policy/session methods — builds ESM+CJS, typechecks clean, tests passing
  - App: React PWA with payment, Passport, and Autopilot pages; policy creation and listing are live on testnet; live gas-status panels cover Send, Batch Pay, Requests, Subscriptions, and Wallet; typecheck, lint, tests, and production build pass
  - paymaster-service: allowlist token API + subscription keeper + receipt issuance endpoint — typechecks clean
  - Protocol stats: reorg-aware indexer (`paymaster-service/src/indexer/*`) over the deployed
    contracts → JSON store; read-only `/api/protocol/*` (global) and `/api/me/*` (wallet-scoped)
    endpoints; SDK `qevie.stats.*`; public `/protocol` dashboard (+ `/stats` redirect), landing
    proof strip on Onboarding, and connected stats on Dashboard + Autopilot. Single-chain per
    process (mainnet/testnet never mix). vitest: aggregator + store + SDK stats tests passing.
    Known missing on-chain events (shown as "not emitted on-chain", never faked): guardian
    approvals, on-chain policy pause, per-UserOp paymaster mode + native-fallback counter — adding
    these needs a mainnet contract redeploy (deferred). Indexer is additive and disable-able via
    `INDEXER_ENABLED=false`. Indexing status: pending first live run on the VPS (cold-start
    backfill from `INDEXER_START_BLOCK`); plan in `docs/QEVIE_PROTOCOL_STATS_DASHBOARD_PLAN.md`.
  - infra: Voltaire bundler docker-compose (unsafe mode)
  - Live bundler: receipt lookup fixed with two recent 10,000-block log ranges; fresh receipt and policy creation probes passed on 2026-06-08
  - Paymaster-first behavior restored: sponsored mint and sponsored policy creation pass again after a clean bundler restart; SDK no longer auto-demotes to `self`
  - Autopilot submitted payments now stay in `confirming` until receipt reconciliation, and the activity page no longer shows placeholder `Pending` labels
  - Paymaster root cause identified locally: Mode B non-signature rejections were returning ERC-4337 `validationData = 1`, which Voltaire classified as `AA34 signature error` and used to ban the paymaster; contract and tests now distinguish real signature failure from policy/budget/target rejects
  - README.md is the consolidated source for architecture, deployment, verified addresses, and current status
- Next action: 
  1. Run a live session-key autonomous payment through the running bundler
  2. Implement Autopilot service agents, audit logs, and gas decision flow
  3. Verify the gas-mode UX against live sponsored and QUSDC-funded operations
  4. Carefully deploy and verify the full stack on mainnet 1990
