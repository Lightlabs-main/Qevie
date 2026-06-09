# Agent-Native Reposition + QIE Domain Resolver Integration Plan

> Status: implementation plan (authored before app-code edits, per the reposition brief).
> Goal: reposition Qevie from "manual payment app with an agent feature" into
> "agent-native QUSDC execution infrastructure on QIE" **without breaking the
> existing build**, and wire the QIE Domain Resolver into agent + policy flows
> **safely** (resolved addresses locked on-chain, never auto-following domains).

This is a **reposition**, not a rewrite. Every manual rail (Send, Batch, Links,
QR, Requests, Subscriptions) stays functional and reachable. They are reframed
as *execution rails* that Autopilot agents can call, and kept under a secondary
**Manual Rails** surface.

---

## 0. Verified baseline (before changes)

- `pnpm -r typecheck` → sdk / app / paymaster-service all clean.
- `forge test` → **72 tests passing**, 0 failing (6 suites).
- No node_modules / forge initially; installed pnpm deps + Foundry 1.7.1.

Rollback anchor commit: `35ed8b5` (`feat: deploy Qevie stack to QIE mainnet (1990)`).

---

## 1. Current routes (app/src/App.tsx)

Authenticated routes today:

| Path | Page | Role |
|------|------|------|
| `/` | `Home` | wallet-style dashboard (balance + service tiles) |
| `/send` | `Send` | manual single payment (already supports `name.qie` via `client.resolve`) |
| `/links` | `PaymentLinks` | payment link rail |
| `/scan` | `Scan` | QR rail |
| `/batch` | `BatchPay` | batch rail |
| `/subscriptions` | `Subscriptions` | subscription rail |
| `/dashboard` | `Dashboard` | wallet detail |
| `/profile` | `Profile` | profile |
| `/history` | `History` | activity history |
| `/passport`, `/passport/:id` | `Passport` | passport |
| `/receipt/:receiptId` | `ReceiptDetail` | receipt |
| `/developers` | `Developers` | SDK docs |
| `/autopilot` | `Autopilot` | agent dashboard |
| `/autopilot/new` | `AutopilotNew` | create policy |
| `/autopilot/policies` | `AutopilotPolicies` | list policies |
| `/autopilot/activity` | `AutopilotActivity` | agent activity |
| `/pay` | `PayLink` | public pay-link landing (also unauthenticated) |

Unauthenticated: `/onboard` (`Onboarding`), `/pay` (`PayLink`).

**Rule:** none of these paths are removed. New paths are added; `/` is repositioned.

## 2. Current nav (app/src/components/BottomNav.tsx)

Bottom tabs today: Home `/`, Links `/links`, **Pay** `/send` (center), Wallet
`/dashboard`, History `/history`. Wallet-first framing.

## 3. Current Autopilot files

- App: `pages/Autopilot.tsx`, `AutopilotNew.tsx`, `AutopilotPolicies.tsx`,
  `AutopilotActivity.tsx`; `lib/autopilot.ts`, `lib/autopilotIntents.ts`,
  `lib/sessionKeys.ts`, `lib/gasless.ts`, `lib/useGasStatus.ts`.
- SDK: `agent/{index,types,abis}.ts`; `client.ts` `agent.*` methods
  (`createSessionPolicy`, `listSessionPolicies`, `getSessionPolicy`,
  `executeAutopilotPayment`, `getAutopilotGasStatus`).
- Service: `autopilot-executor.ts`, `autopilot-intents.ts`, `session-keys.ts`.
- Contracts: `agent/AgentPolicyManager.sol`, `agent/AgentTypes.sol`,
  `agent/IAgentPolicyManager.sol`; session-key path in `account/QevieSmartAccount.sol`.

## 4. Current manual rail files

- `pages/Send.tsx`, `BatchPay.tsx`, `PaymentLinks.tsx`, `Scan.tsx`,
  `Request.tsx`, `Subscriptions.tsx`, `PayLink.tsx`.
- SDK rails: `client.pay`, `paySubmit`, `batchPay`, `requestPayment`,
  `payRequest`, `subscribe`, `cancelSubscription`, `buildQrUri`, `parseQrUri`,
  `createPaymentLink`, `parsePaymentLink`.
- Contracts: `payments/BatchPayments.sol`, `payments/PaymentRequest.sol`,
  `subscriptions/SubscriptionManager.sol`.

## 5. Current SDK methods (preserved verbatim — agent tools wrap these)

`createQevieClient`, `account`, `resolve`, `pay`, `paySubmit`, `batchPay`,
`requestPayment`, `payRequest`, `payRequestSubmit`, `subscribe`,
`cancelSubscription`, `getSubscription`, `registerUsername`, `quoteGas`,
`buildQrUri`, `parseQrUri`, `createPaymentLink`, `parsePaymentLink`,
`receipts.*`, `passport.*`, `agent.*`, `gas.*`. **No signature changes.**

## 6. Current chain config files (must remain intact)

- `sdk/src/contracts.ts` → `TESTNET_CONTRACTS` (1983), `MAINNET_CONTRACTS` (1990).
  Deployed addresses are **not** overwritten; only **optional** fields added.
- `sdk/src/chains.ts`, `app/src/config.ts`, `paymaster-service/src/config.ts`.
- `paymaster-service/src/config.ts` already pins the verified QIE Domains
  registry proxy `0x26cCB3fABd6db18834987134d715Ba2346CE7223` (reverse lookups).

---

## 7. QIE Domain Resolver — honest design

**Constraint discovered:** the verified QIE Domains registry (`IQIEDomains`,
`sdk/src/abis.ts`) exposes only `userDomain(address) → string` (**reverse**) and
`domainExist(string) → bool`. There is **no verified forward** (`name → address`)
method on the known registry. So:

- **Forward resolution (`name.qie → 0x…`)** is only performed when a forward
  resolver contract + method are explicitly configured (env). With no forward
  resolver configured, `.qie` forward resolution is **unavailable** and we say so
  — we never fabricate an address.
- **Reverse verification** *is* available and is used as the trust check: given a
  candidate address we read `userDomain(addr)` and confirm it equals the claimed
  `name.qie`. This powers (a) verifying a `fallback=0x…` in links/QR, and
  (b) Passport domain labels.
- The existing `client.resolve()` keeps its current behaviour (bare-name +
  username-registry fallback) for backward compatibility. A new, stricter
  `client.resolveDetailed()` returns a typed `ResolvedRecipient` (with `source`
  and `verified`) for agent/policy flows.

### Adapters (`sdk/src/identity/resolverAdapter.ts`)

- `DisabledQieResolverAdapter` — default; `resolve()` returns `null`
  ("not configured"). Reverse verification still works through the registry.
- `EnsLikeQieResolverAdapter` — tries a configured resolver address using a small
  set of read-only forward method shapes; returns `null` if none resolve.
- `CustomQieResolverAdapter` — caller supplies the forward function name.

### `resolveRecipient` order (`sdk/src/identity/resolveRecipient.ts`)

1. `0x…` address → `{kind: address, verified: true, source: direct_address}`.
2. `name.qie` → forward adapter (if configured) → reverse-verify via `userDomain`.
   If unconfigured/unresolved → typed failure (block; never guess).
3. bare `name` → `UsernameRegistry.resolve` → `{kind: qevie_username}`.

### Where it is wired

- SDK: `resolveDetailed`, agent tools, intent recipient resolution.
- App: Agent Commands preview, AutopilotNew policy recipients (resolve → lock
  address → on-chain), Send badge, PayLink/Scan `to=name.qie&fallback=0x…`.
- Service: `identity/resolve-recipient.ts` (preview only). **Executor keeps using
  the locked policy address (`intent.recipient`) — it never re-resolves to
  override a policy.**

### Why the policy-locking requirement is already structurally satisfied

`AgentPolicyManager.createPolicy` accepts `recipients` as `address[]` and stores
addresses in `_allowedRecipients[policyId][addr]`. It has **no concept of a
domain string** — so a policy can only ever encode resolved addresses, and an
existing policy can never "follow" a later domain change. The reposition only
adds **UI-side** resolution + a lock/timestamp display + warning copy; the
on-chain guarantee is unchanged (so no contract changes are required, and none
are made — keeping the deployed AgentPolicyManager bytecode intact).

---

## 8. Exact changes

### SDK (`sdk/src`)
- `contracts.ts`: add optional `qieDomainResolver?`, `qieDomainRegistry?` to
  `QevieContracts` (no address values changed).
- `identity/types.ts`: `QieDomainConfig`, `ResolvedRecipient`,
  `QieDomainResolverAdapter`, `ResolveRecipientResult`.
- `identity/qieDomains.ts`: reverse lookup + existence helpers.
- `identity/resolverAdapter.ts`: three adapters + `createResolverAdapter`.
- `identity/resolveRecipient.ts`: `resolveRecipientDetailed`.
- `identity/index.ts` + `index.ts`: exports.
- `types.ts`: `QevieClientConfig.qieDomain?: QieDomainConfig`.
- `client.ts`: build adapter from config; add `resolveDetailed()`; keep `resolve()`.
- `agent/tools/*`: tool registry wrapping existing client methods.
- `agent/intent/*`: parser + validator + types.
- Tests: `identity/resolveRecipient.test.ts`, `agent/intent/parser.test.ts`,
  `agent/tools/tools.test.ts`.

### App (`app/src`)
- `config.ts`: assemble `qieDomain` config (chain-aware, optional) + pass to client.
- `components/BottomNav.tsx`: Autopilot-first tabs (Autopilot, Agent, Activity,
  Passport, Rails). Routes preserved.
- `App.tsx`: `/` → new `ControlCenter`; add `/agent`, `/agent/commands`, `/rails`;
  keep `Home` at `/wallet`; keep every existing route.
- New `pages/ControlCenter.tsx` (execution control center), `pages/AgentCommands.tsx`,
  `pages/ManualRails.tsx`.
- `pages/Autopilot.tsx`: agent-native copy, dashboard cards, agent loop.
- `pages/AutopilotNew.tsx`: accept `.qie` recipients → resolve → show locked
  address + warning → submit resolved addresses (unchanged on-chain call).
- `pages/Send.tsx`: resolved-by badge.
- `lib/agentCommands.ts`: glue parser + resolver + tool-plan preview for the page.

### Service (`paymaster-service/src`)
- `identity/qie-domain-resolver.ts`, `identity/resolve-recipient.ts` (preview).
- No change to executor recipient handling (locked address preserved).

### Docs
- `README.md`, `SECURITY.md`, `VERIFICATION.md`, `.env.example`, this plan.

---

## 9. Safe rollback path

- All SDK config additions are **optional fields** — omitting them reproduces
  current behaviour exactly. Setting no `qieDomain` env ⇒ Disabled adapter ⇒
  `.qie` strict resolution is cleanly unavailable, nothing crashes.
- New pages/routes are additive; reverting `App.tsx` + `BottomNav.tsx` restores
  the prior surface with all old pages intact.
- No contract source/bytecode changes ⇒ deployed addresses untouched ⇒ instant
  revert with `git revert` of the reposition commit. Baseline anchor `35ed8b5`.

## 10. Tests to add / update

- SDK (vitest, already configured): parser (send/batch/link/subscription/request/
  ambiguous/multi-step), resolver (direct / `.qie` configured / `.qie` disabled /
  username fallback / reverse-verify), tool-plan → SDK-method mapping.
- Contract: existing 72 stay green (no contract change). Documented that policy
  recipients are address-only (no domain string on-chain) — already covered by
  `AgentPolicyManager.t.sol` recipient-allowlist tests.
- Service/App: lightweight where infra exists; otherwise asserted via SDK tests
  that both consume (resolver + parser are shared logic).
