# AGENTS.md — qevie / passpay

Shared conventions for any AI coding agent (Codex, Claude Code, Jules, Cursor, Aider, Zed)
working in this repo. Read this file fully before doing anything. Then read VERIFICATION.md.

## What this is
Gasless stablecoin payments app on QIE mainnet (Chain ID 1990) + a TypeScript SDK.
ERC-4337 account abstraction, QUSDC settlement, recurring/batch/QR payments.
Full spec lives in the original build prompt; this file is the operating contract.

## Golden rules (never violate)
1. VERIFY BEFORE YOU CODE. No contract address is used until it is confirmed on
   https://mainnet.qie.digital/ and recorded in VERIFICATION.md. Never invent/guess an address.
2. REAL MAINNET, NO MOCKS in shipped paths. Mocks live only under test/. The deliverable
   runs on chain 1990 with real QUSDC and a real-QIE-funded paymaster.
3. TESTNET (1983) FOR DEV, MAINNET (1990) FOR DELIVERY.
4. PAYMASTER = REAL MONEY. Caps, Sybil-gating, scoped sponsorship, reentrancy guards. Always.
5. ORIGINAL CODE. Reference UX from external apps is fine; copying/forking code is not.
6. NO SECRETS IN GIT. Use .env (+ .env.example). Never print or commit keys.
7. If blocked, write it in VERIFICATION.md with the safest labeled fallback. Do not ship a fabricated value.

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
  any new verified addresses (also in VERIFICATION.md), and open blockers.

## Build order (do not reorder)
Phase 0 Verify -> Phase 1 AA core on testnet -> GO/NO-GO (4337 vs EIP-2771 fallback)
-> Phase 2 Paymaster -> Phase 3 Payment contracts -> Phase 4 SDK -> Phase 5 App
-> Phase 6 Mainnet deploy + verify -> Phase 7 Ship.

## Status / Handoff (keep current)
- Current phase: Autopilot contract foundation and config-gated app UI complete — session-key policy contracts, smart-account/paymaster changes, Autopilot dashboard, policy form, policy list, activity page, gas status, and pipeline UI implemented
- 4337 vs relayer decision: ERC-4337 via Voltaire unsafe/no-trace bundler (direct handleOps smoke test confirmed on testnet)
- Verified addresses: see VERIFICATION.md
- Open blockers: 
  - Phase 2-3 contracts not yet deployed on testnet (run DeployAll.s.sol with funded key)
  - Paymaster needs funded EntryPoint deposit before gasless ops work
  - QIE Pass on-chain gating unavailable; using QIE Domain + signed allowlist fallback
  - Real bundler (Voltaire) E2E not yet tested through full UserOp lifecycle
  - ReceiptRegistry is implemented but not yet deployed and verified on QIE; Passport/Receipt UI stays config-gated until `VITE_RECEIPT_REGISTRY_ADDRESS` is set to a verified deployment
  - Autopilot SDK transaction methods and service agents are not implemented yet
  - AgentPolicyManager is not deployed or verified, so policy creation is correctly disabled in the app
- What is built and tested:
  - Contracts: QevieSmartAccount, Factory, QeviePaymaster (Mode A + B), BatchPayments, 
    PaymentRequest, SubscriptionManager, UsernameRegistry, ReceiptRegistry, AgentPolicyManager, and session-key execution path — Foundry suite passing locally and on VPS (62 tests)
  - SDK: @qevie/sdk core + React hooks + receipt/passport methods — builds ESM+CJS, typechecks clean, vitest receipt suite passing
  - App: React PWA with payment, Passport, and Autopilot pages (`/autopilot`, `/autopilot/new`, `/autopilot/policies`, `/autopilot/activity`) — typecheck, lint, and production build passing
  - paymaster-service: allowlist token API + subscription keeper + receipt issuance endpoint — typechecks clean
  - infra: Voltaire bundler docker-compose (unsafe mode)
  - docs: `docs/QEVIE_AUTOPILOT_IMPLEMENTATION_PLAN.md` added with merged Path B + sustainable gas plan
- Next action: 
  1. Extend the SDK for session policies, session UserOps, and normalized gas-mode APIs
  2. Implement Autopilot service agents, audit logs, and gas decision flow
  3. Add explicit gas-mode UX to current payment confirmation flows
  4. Run Voltaire bundler + end-to-end gasless/session UserOp tests on QIE testnet
  5. Deploy and verify ReceiptRegistry and Autopilot contracts on testnet, then mainnet 1990
  6. Fund paymaster EntryPoint deposit and complete ship checklist
