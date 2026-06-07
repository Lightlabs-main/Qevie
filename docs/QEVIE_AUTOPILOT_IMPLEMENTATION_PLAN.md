# Qevie Autopilot + Sustainable Gas Implementation Plan

Date: 2026-06-07

This plan merges the two user prompts into one implementation track:

1. Build Path B fully: on-chain-enforced autonomous session-key execution for Qevie smart accounts.
2. Update the existing Qevie gas model so the app and Autopilot both expose the real execution modes:
   - sponsored onboarding
   - QUSDC-funded gas through the paymaster
   - native QIE fallback
   - paused state when no safe gas route exists

This plan reflects the repo as it exists now. It does not assume greenfield code.

## Current Architecture Snapshot

### Contracts

- `contracts/src/account/QevieSmartAccount.sol`
  - single-owner ERC-4337 account
  - validates only owner ERC-191 signatures over `userOpHash`
  - exposes `execute` and `executeBatch`
  - has no session-key path yet
- `contracts/src/paymaster/QeviePaymaster.sol`
  - already has two modes:
    - Mode A: pay gas in QUSDC
    - Mode B: sponsored free tier
  - already enforces:
    - `PER_ACCOUNT_CAP = 3`
    - allowed target checks for sponsored mode
    - DEX-based QUSDC quote using verified WQIE/QUSDC pair
  - gaps vs merged prompt:
    - gas modes are not modeled consistently across app/SDK/service
    - QUSDC gas caps are global, not user-configurable
    - no explicit paused mode
    - no Autopilot-aware paymaster validation
- payment contracts already exist:
  - `BatchPayments`
  - `PaymentRequest`
  - `SubscriptionManager`
  - `ReceiptRegistry`

### SDK

- `sdk/src/client.ts`
  - already supports pay, batch pay, request, pay request, subscribe, receipts, passport
- `sdk/src/account.ts`
  - builds owner-signed UserOps
  - supports current gas modes: `"sponsored" | "qusdc" | "self"`
- `sdk/src/types.ts`
  - current gas model is too thin for the requested UX and Autopilot policies
- `sdk/src/contracts.ts`
  - has current contract config but no `agentPolicyManager`

### Service

- `paymaster-service/src/index.ts`
  - lightweight HTTP server
  - issues Mode B allowlist tokens
  - exposes receipt issuance endpoint
- `paymaster-service/src/keeper.ts`
  - recurring subscription executor
  - best starting point for Autopilot orchestration

### App

- existing routes cover payment, links, scan, batch, subscriptions, dashboard, profile, history, passport, developers
- app currently resolves gas using `app/src/lib/gasless.ts`
  - sponsored first
  - falls back directly to native-QIE self-pay
  - no QUSDC gas selection UI
  - no paused-state UX
  - no Autopilot routes

## Verified Inputs and Address Constraints

- Verified QIE/QUSDC/QIEDex inputs are recorded in `VERIFICATION.md`.
- Mainnet verified:
  - QUSDC
  - WQIE
  - QIEDex router
  - QIEDex factory
  - WQIE/QUSDC pair
- No new mainnet address will be hardcoded unless added to `VERIFICATION.md`.
- Testnet remains the dev target until deploy/verify is complete.

## Merged Product Definition

Qevie Autopilot is a session-key-based autonomous payment layer for Qevie smart accounts where:

- the user creates an on-chain scoped policy once
- a session key can sign UserOperations within that policy
- the smart account validates the session signature
- an `AgentPolicyManager` enforces:
  - QUSDC-only token scope for MVP
  - recipient allowlists
  - allowed action types
  - max per transaction
  - daily / weekly / total spend caps
  - validity window
  - guardian revocation
  - gas behavior and gas-related caps
- the paymaster only sponsors or charges gas inside supported gas modes
- receipts and passport history capture autonomous activity

This is not proposal-only flow. Contracts remain the enforcement boundary.

## Required Design Adjustments Against the Existing Repo

### 1. Gas model is partially present already

The prompt says to add sponsored onboarding plus QUSDC gas plus native fallback plus paused mode. The current repo already implements part of this:

- free sponsored quota exists on-chain in the paymaster
- QUSDC gas quoting/charging exists on-chain in the paymaster
- native self-pay exists in the SDK

So the work is to normalize and extend the current system, not replace it.

### 2. Autopilot gas policy must align with existing paymaster mechanics

The prompt proposes large on-chain gas-policy fields per session policy. Full on-chain gas accounting for paymaster post-op cost is not available during account validation. The clean split is:

- on-chain:
  - policy declares allowed gas behaviors and user caps
  - account/policy manager reject session ops that violate declared gas preferences where the violation is knowable pre-execution
- paymaster:
  - enforces sponsorship scope
  - enforces free-tier caps
  - enforces QUSDC quote freshness and charge ceilings
- service:
  - computes gas route before submission
  - pauses Autopilot rather than spamming failing ops

### 3. Session-key execution should use dedicated functions

The current account only has generic `execute` and `executeBatch`. To keep owner flow backward-compatible and make policy recording explicit, session-key flow should use:

- `executeSession(...)`
- `executeSessionBatch(...)`

Owner flow keeps existing `execute` / `executeBatch`.

## File-Level Implementation Plan

### Contracts

Add:

- `contracts/src/agent/AgentTypes.sol`
- `contracts/src/agent/IAgentPolicyManager.sol`
- `contracts/src/agent/AgentPolicyManager.sol`
- `contracts/test/AgentPolicyManager.t.sol`
- `contracts/test/QevieSmartAccountSessionKey.t.sol`

Modify:

- `contracts/src/account/QevieSmartAccount.sol`
- `contracts/src/account/QevieSmartAccountFactory.sol`
- `contracts/src/paymaster/QeviePaymaster.sol`
- `contracts/test/QeviePaymaster.t.sol`
- deployment scripts under `contracts/script/`

Contract goals:

- preserve owner-signed UserOps
- add session-signature envelope decoding
- add policy manager reference
- add session execution entrypoints
- decode supported payment calls in the policy manager
- record spend windows and caps
- add guardian revocation
- tighten paymaster scope for session execution
- expose normalized gas status helpers

### SDK

Add:

- `sdk/src/agent/types.ts`
- `sdk/src/agent/policy.ts`
- `sdk/src/agent/sessionKey.ts`
- `sdk/src/agent/autopilot.ts`
- `sdk/src/agent/index.ts`

Modify:

- `sdk/src/client.ts`
- `sdk/src/account.ts`
- `sdk/src/userop.ts`
- `sdk/src/types.ts`
- `sdk/src/contracts.ts`
- `sdk/src/index.ts`
- tests in `sdk/src/*.test.ts`

SDK goals:

- normalize gas modes to prompt language
- keep compatibility shims for existing `"sponsored" | "qusdc" | "self"` callers where reasonable
- add session policy CRUD
- add session UserOp build/sign helpers
- expose Autopilot activity and gas-status methods

### Service

Add:

- `paymaster-service/src/agents/types.ts`
- `paymaster-service/src/agents/watcher-agent.ts`
- `paymaster-service/src/agents/reputation-oracle.ts`
- `paymaster-service/src/agents/strategist-agent.ts`
- `paymaster-service/src/agents/guardian-agent.ts`
- `paymaster-service/src/agents/executor-agent.ts`
- `paymaster-service/src/agents/receipt-passport-agent.ts`
- `paymaster-service/src/agents/orchestrator.ts`
- `paymaster-service/src/agents/routes.ts`

Modify:

- `paymaster-service/src/index.ts`
- `paymaster-service/src/keeper.ts`
- `paymaster-service/src/config.ts`

Service goals:

- reuse keeper patterns instead of duplicating them
- add deterministic first-pass strategist and guardian logic
- add gas-route decisioning
- add pause behavior and audit logs
- keep LLM optional and schema-validated only

### App

Add:

- `app/src/pages/Autopilot.tsx`
- `app/src/pages/AutopilotNew.tsx`
- `app/src/pages/AutopilotPolicies.tsx`
- `app/src/pages/AutopilotActivity.tsx`

Modify:

- `app/src/App.tsx`
- `app/src/lib/gasless.ts`
- payment pages that confirm/submit actions
- relevant nav/home/dashboard surfaces

App goals:

- show gas mode explicitly on existing payment flows
- show sponsored quota usage
- show QUSDC gas estimates and limits
- show paused reasons
- add Autopilot dashboard, policy creation, policies list, activity

## Contract Strategy

### AgentPolicyManager

Primary storage:

- `policyNonce[smartAccount]`
- `policies[policyId]`
- `policiesBySmartAccount[smartAccount]`
- `allowedRecipients[policyId][recipient]`
- `allowedTargets[target]`

Policy content:

- account / owner / sessionKey / guardian / token
- spend caps
- spend counters
- window starts
- validity window
- action booleans
- gas policy fields
- active / revoked flags

Gas policy fields will include:

- preferred/fallback gas behavior flags
- per-tx QUSDC gas max
- daily QUSDC gas cap
- gas-day counters
- pause-on-unavailable behavior

Validation flow:

- reject unsupported target, selector, non-zero native value
- decode supported call shapes only
- derive recipient(s), token, amount(s), action type
- enforce recipient allowlist and caps
- compute effective window spend in memory in view path
- commit spend in record path

Supported actions in MVP:

- direct QUSDC `transfer`
- `BatchPayments.batchPay`
- `PaymentRequest.createRequest` and `payRequest`
- `SubscriptionManager.subscribe`

Subscription charging by an agent is lower priority than policy creation and session payment flow. If existing contract ownership model makes autonomous `charge()` unsafe or semantically wrong for Path B, keep subscription execution scoped to explicit supported cases and document the narrower first implementation.

### Smart Account

Changes:

- add `agentPolicyManager`
- add signature mode envelope:
  - owner
  - session key
- require session-key UserOps to call `executeSession` or `executeSessionBatch`
- validate that signature policyId matches callData policyId
- recover session signer from userOp hash
- ask policy manager to validate the decoded session call
- record policy spend during execution

Compatibility requirement:

- existing owner signature path remains intact
- existing app/SDK payment flow must continue working

### Paymaster

Existing strengths:

- per-account sponsored cap already matches the new requirement
- QUSDC gas model already exists with DEX price quote

Needed changes:

- rename or alias gas-mode concepts across SDK/app/service
- add richer read helpers for:
  - sponsored status
  - pause reasons
  - QUSDC gas quote metadata
- restrict sponsored and QUSDC paymaster acceptance to:
  - existing supported Qevie payment flows
  - session execution selectors for Autopilot
- add per-user max QUSDC gas guard path
- add better pause behavior for unavailable quotes / allowance / balance issues

## SDK Reuse Plan

Reuse:

- `QevieAccount` for address derivation and owner path
- `BundlerClient` for submission and receipt tracking
- existing contract ABI export pattern
- existing receipt/passport helpers

Add:

- session signature envelope encoders/decoders
- `buildSessionUserOp`
- `signSessionUserOp`
- agent policy methods on `QevieClient`
- `gas` namespace methods:
  - sponsored status
  - gas mode options
  - QUSDC gas quote
  - Autopilot gas status

Compatibility approach:

- add a new `QevieGasMode` surface matching the prompt
- preserve legacy `"sponsored" | "qusdc" | "self"` internally or via adapters until app migration is complete

## Service / Agent Pipeline Plan

Execution pipeline:

1. Watcher finds due or candidate actions.
2. Reputation Oracle assembles passport / receipt signals.
3. Strategist makes deterministic decision.
4. Guardian validates decision against policy and risk rules.
5. Gas decision step selects:
   - sponsored onboarding
   - QUSDC gas
   - native QIE
   - paused
6. Executor builds session-key UserOp and submits it.
7. Receipt/Passport agent writes audit trail and receipt follow-up.

Storage:

- if Supabase is already wired in local repo, use it
- otherwise store JSONL audit logs under a local service path inside the repo deployment area and document it

LLM use:

- optional only
- JSON output only
- Zod validation
- deterministic fallback always available

## App UX Plan

Existing payment flows will all show gas mode:

- Send
- Batch
- Payment link payment
- QR payment
- Payment request settlement
- Subscription creation

Autopilot routes:

- `/autopilot`
- `/autopilot/new`
- `/autopilot/policies`
- `/autopilot/activity`

Core UX rules:

- never say “forever gasless”
- say sponsorship is capped
- say QUSDC gas uses QIEDex WQIE/QUSDC pricing
- say Autopilot pauses if no safe gas route exists

## Test Plan

### Contracts

Add focused suites for:

- `AgentPolicyManager`
- session-key validation in `QevieSmartAccount`
- paymaster gas mode coverage

Keep and extend existing tests rather than replacing them.

### SDK

Add tests for:

- policy encoding
- session envelope encoding
- gas helpers
- config errors
- activity and mapping logic

### Service

Add tests for:

- watcher
- reputation unknown/success paths
- strategist fallback
- guardian veto logic
- executor session-op build
- orchestrator pause behavior
- audit log writes

### App

At minimum:

- typecheck
- route wiring
- component-level tests only where behavior is nontrivial

## Deployment Impact

New deployables:

- `AgentPolicyManager`
- upgraded `QevieSmartAccount` / factory if constructor changes are required

Paymaster config updates:

- allowed targets for current Qevie flows
- allowed targets for session execution
- verified DEX route config remains sourced from `VERIFICATION.md`

Config changes:

- `.env.example`
- SDK contracts config
- service env for session/guardian keys

Mainnet rule:

- do not set any new mainnet contract address until it is verified and recorded in `VERIFICATION.md`

## Delivery Order

1. Contracts:
   - `AgentPolicyManager`
   - smart account session path
   - paymaster restrictions and gas helpers
   - contract tests
2. SDK:
   - gas-mode normalization
   - policy/session helpers
   - tests
3. Service:
   - Autopilot agents
   - gas decisioning
   - audit logs
4. App:
   - gas panels on existing flows
   - Autopilot routes and pages
5. Verification:
   - `pnpm contracts:build`
   - `pnpm contracts:test`
   - `pnpm --filter @qevie/sdk typecheck`
   - `pnpm --filter @qevie/sdk build`
   - service tests/build
   - `pnpm -r typecheck`
   - `pnpm -r lint`
   - `pnpm -r build`

## Known Risk Areas Before Coding

1. The prompt’s requested `validateSessionCall(... string memory reason)` interface is expensive for validation paths. Keep revert reasons / enums compact where needed and adapt SDK/service to parse them.
2. `PaymentRequest.createRequest` does not move funds, so policy handling for that action needs clear semantics separate from payment-settlement actions.
3. Subscription autonomy interacts with the current `SubscriptionManager` trust model and may need a narrower first implementation to avoid semantic breakage.
4. Full on-chain enforcement of post-op gas accounting is impossible at account validation time; the design must split responsibilities cleanly between policy manager, paymaster, and executor.
5. This repo already uses mocks in `contracts/test/helpers`; shipped-path changes must not leak test-only helpers or assumptions.

## Immediate Next Coding Step

Start with contracts. They define the enforcement boundary and will determine the SDK and service surface cleanly.
