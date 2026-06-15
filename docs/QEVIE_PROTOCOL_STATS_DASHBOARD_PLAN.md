# Qevie Protocol Stats, Public Dashboard, Landing Proof Strip & Live Activity Feed — Implementation Plan

Status: **DRAFT — awaiting review before implementation.**
Author: Lightlabs
Repo: `Lightlabs-main/Qevie` (branch `main`, plan written against `6a839cd`).
Scope: add real protocol stats in four placements (landing proof strip, `/protocol` dashboard, connected dashboard, Autopilot page) plus a live activity feed — without breaking existing flows and without shipping fake data.

---

## 0. Ground-truth inventory (what actually exists)

This plan is written against the **real** codebase, not the generic spec. The differences below are deliberate.

### 0.1 Backend (`paymaster-service/`)
- Plain Node `http.createServer` with manual URL routing in `src/index.ts` (423 lines, no Express/Fastify). New endpoints are added as `if (req.url === ... )` branches in the same style.
- **Single chain per process.** `src/config.ts`: `CHAIN_ID` is fixed at boot — `1983` (QIE testnet) when `USE_TESTNET=true`, else `1990` (QIE mainnet). `RPC_URL`, `CONTRACTS`, addresses all resolve from that one chain. There is **no** in-process multi-chain support today.
- **Storage = JSON files**, not a database. `csv-import-store.ts` documents the pattern: a generic JSON-array store using `readFileSync`/`writeFileSync(path, JSON.stringify(...), { mode: 0o600 })`, store paths from `config.ts` (e.g. `AUTOPILOT_INTENT_STORE_PATH`, `CSV_IMPORT_JOB_STORE_PATH`). **There is no Supabase or SQL.** This plan reuses the JSON-file store pattern; the spec's Supabase migrations are intentionally dropped.
- Has viem clients already (publicClient against `RPC_URL`), an Autopilot executor, receipts issuer, rebalancer, keeper, dex-heartbeat, CSV importer. No indexer exists yet.
- Existing routes: `/health`, `/allowlist-token`, `/session-key`, `/autopilot/intent`, `/autopilot/intents`, `/autopilot/cancel`, `/resolve-recipient`, `/receipts`, `/csv-import/*`.

### 0.2 Contracts and the events they actually emit (`contracts/src/`)
| Contract | Emitted events available **today** |
|---|---|
| `AgentPolicyManager` | `AgentPolicyCreated(policyId, smartAccount, sessionKey, guardian, token, validUntil)`, `AgentPolicyRevoked(policyId, smartAccount)`, `AgentPolicyGuardianRevoked(policyId, guardian, reason)`, `AgentPolicySpendRecorded(policyId, smartAccount, sessionKey, actionType, amount)`, `AgentPolicyRecipientUpdated`, `AgentPolicyAllowedTargetUpdated` |
| `QevieSmartAccount` | `SessionExecution(policyId, sessionKey, target, value, data)`, `SessionBatchExecution(policyId, sessionKey, callCount)`, `Executed(target, value, data, result)` |
| `QevieSmartAccountFactory` | `AccountCreated(account, owner, salt)` |
| `QeviePaymaster` | `ModeACharge(account, qusdcCharged, gasCostWei)` (= QUSDC-gas), `ModeBSponsored(account, gasCostWei, remainingOps)` (= sponsored onboarding), `Paused(by)`, `Unpaused(by)` |
| `ReceiptRegistry` | `ReceiptCreated(receiptId, payer, payee, token, amount, amountPrivate, metadataHash, paymentReference, receiptType, issuer, timestamp)` |
| `PaymentRequest` | `RequestCreated`, `RequestPaid(requestId, payer, amount)`, `RequestCancelled` |
| `BatchPayments` | `BatchPaid(...)` |
| `SubscriptionManager` | `Subscribed`, `Charged(...)`, `Cancelled` |
| `UsernameRegistry` | `UsernameRegistered`, `UsernameReleased` |
| `QUSDC` (ERC-20) | `Transfer(from, to, value)` |

### 0.3 Contract addresses (`sdk/src/contracts.ts`)
- Mainnet (1990) has `agentPolicyManager`, `paymaster`, `receiptRegistry`, `batchPayments`, `paymentRequest`, `subscriptionManager`, `usernameRegistry`, `qusdc`.
- **Testnet (1983) has NO `receiptRegistry` address.** → Receipt metrics must show a graceful "not configured on this network" state on testnet, not zero-as-fact.
- QIE Domain resolution happens in the **service** (`paymaster-service/src/identity/qie-domain-resolver.ts` + `resolve-recipient.ts`) and is **not** an on-chain event. Domain metrics are service-sourced, labeled as such.

### 0.4 SDK (`sdk/src/`)
- `QevieClient` class (`client.ts`) exposes namespaces: `receipts`, `passport`, `gas` (`GasModule`), `agent`, `bundler`. We add a `stats` namespace following the same shape. Config carries `bundlerUrl`, `contracts`, `publicClient`. We add an optional `statsApiUrl`.

### 0.5 Frontend (`app/`)
- Vite + React 19 + `react-router-dom` v7 SPA, built with `tsc && vite build` to `app/dist`. Served **statically by nginx** on the VPS (port 8080, `try_files $uri /index.html`), so new client routes need no server change — only a rebuild + redeploy of `dist` to `/var/www/qevie`.
- Routes in `app/src/App.tsx`. Landing = `pages/Home.tsx`. Connected dashboard = `pages/Dashboard.tsx`. Autopilot = `pages/Autopilot.tsx` (+ `AutopilotPolicies`, `AutopilotActivity`, `AutopilotNew`). Components dir is small (`AgentPipeline`, `BottomNav`, `GasStatusPanel`, `Logo`). No chart library installed.

### 0.6 Deployment (VPS `38.49.209.149`, host `maris`)
- Source monorepo `/opt/qevie` (git `main`, in sync with this workspace). Built frontend copied to `/var/www/qevie`. pm2 processes: `qevie-app`, `qevie-bundler`, `qevie-paymaster`. Mainnet process serves mainnet only.

---

## 1. What we can compute now vs. what needs new on-chain events

### 1.1 Computable immediately from existing events / service state (NO contract changes)
- **Policies:** confirmed (count of `AgentPolicyCreated`), revoked (`AgentPolicyRevoked`), expired (`validUntil < now`), active (created − revoked − expired). Guardian revocations + reasons (`AgentPolicyGuardianRevoked`).
- **Pending policies:** the service submits policy-creation UserOps; we record a `pending` event when submitted and flip to `confirmed` when `AgentPolicyCreated` is observed. (App-only-submitted policies the service never sees cannot be "pending" — documented limitation.)
- **Autopilot executions:** `SessionExecution` + `SessionBatchExecution` counts.
- **QUSDC volume (confirmed):** `AgentPolicySpendRecorded.amount` for agent flow; `BatchPaid` recipient sums; `Charged` (subscription executed) amounts; `RequestPaid.amount`; and QUSDC `Transfer` filtered to Qevie smart accounts / payment contracts. Volume is the union de-duplicated by `(txHash, logIndex)` to avoid double counting a transfer that also has a domain-level event.
- **Paymaster usage:** `ModeBSponsored` (sponsored onboarding), `ModeACharge` (QUSDC-gas, includes `qusdcCharged` + `gasCostWei` → "QUSDC gas recovered" / "estimated QIE gas paid"), `Paused`/`Unpaused` (gas-route paused state).
- **Receipts:** `ReceiptCreated` count, 24h, public vs private (`amountPrivate`), by `receiptType`, by `issuer` (agent vs manual).
- **Domains (service-sourced):** resolution attempts/successes/failures + payments to `.qie` recipients, logged by the resolver.

### 1.2 Requires NEW on-chain events → **OUT of initial scope** (needs mainnet contract redeploy; rule 0 forbids silently)
Marked in UI as derived/approximate or disabled — never faked:
- `GuardianApproved` — not emitted. Guardian **approvals** are shown as "—" / "not emitted on-chain"; only guardian **revocations/vetoes** (`AgentPolicyGuardianRevoked`) are real.
- `AgentPolicyPaused` / `AgentPolicyResumed` — no on-chain pause state. "Paused policies" is sourced from the **service gas-route state** where it exists, else shown as N/A. Not invented.
- `PaymasterModeUsed(account, mode, userOpHash)` / native-fallback marker — per-UserOp mode with userOpHash isn't emitted. We approximate mode split from `ModeACharge`/`ModeBSponsored`; "native fallback" and total UserOps routed are labeled "from EntryPoint receipts where available," else omitted.

A **separate, explicitly-approved** follow-up task can add these events + redeploy; tracked in §11.

---

## 2. UI placement plan (matches the four-placement spec)

1. **Landing (`pages/Home.tsx`)** — lightweight proof strip after the hero / "how Qevie works" section: 4 KPI cards (Total QUSDC Volume, Autopilot Executions, Active Policies, Receipts Created) + `MiniLiveFeed` (latest 5–8) + CTA "View Protocol Dashboard →" to `/protocol`. Empty state: "Qevie stats are syncing. Live activity will appear after confirmed events." No charts, no filters.
2. **`/protocol` (new `pages/Protocol.tsx`, new route)** — full public dashboard: header (title, network label, last indexed block, last updated), 4 top KPI cards, tabs (Autopilot / Payments / Paymaster / Receipts & Passport / QIE Domains) with compact cards + lightweight CSS charts, and `FullLiveFeed` (20–50, filters, badges, explorer links). Public, no wallet required.
3. **Connected dashboard (`pages/Dashboard.tsx`)** — a "Your activity" section using `/api/me/stats` + `/api/me/events` filtered to the connected smart account only: my active/pending/revoked/paused policies, my Autopilot executions, my receipts, my Passport activity, my Paymaster/gas usage, my blocked actions. Plus a "View global protocol stats →" link to `/protocol`. **Never** shows global volume here.
4. **Autopilot (`pages/Autopilot.tsx`)** — policy/agent stats: active, pending, next due execution, guardian vetoes (real) / approvals (marked N/A), paused (service-sourced), gas route status (reuse `GasStatusPanel`), recent agent executions. No global protocol volume.

Network separation: every placement reads the chain the stats API serves and labels it (QIE Mainnet / QIE Testnet — Testnet clearly tagged). Mainnet never shows testnet data because the mainnet process only indexes mainnet.

---

## 3. Backend: indexer + storage (extends `paymaster-service`, JSON-file pattern)

New directory `paymaster-service/src/indexer/`:
- `event-types.ts` — `QevieProtocolEventType` union + `QevieProtocolEvent` record type (typed exactly as in the spec §6, no `any`). `chainId` stamped from `config.CHAIN_ID`.
- `store.ts` — JSON-file stores reusing the `csv-import-store.ts` generic-array pattern, mode `0o600`. New store paths in `config.ts`: `PROTOCOL_EVENTS_STORE_PATH`, `DAILY_STATS_STORE_PATH`, `INDEXER_CURSOR_STORE_PATH`. Dedupe key `(chainId, txHash, logIndex)`; pending events keyed by app-generated id.
- `cursor.ts` — reorg-safe cursor. `INDEXER_CONFIRMATION_BLOCKS` env (default 5). Only events at `block <= head - confirmations` become `confirmed`; on cursor regression, reprocess from last safe block.
- `policy-indexer.ts`, `payment-indexer.ts`, `paymaster-indexer.ts`, `receipt-indexer.ts`, `domain-indexer.ts` — each pulls its events via viem `getLogs` against the existing publicClient + `CONTRACTS` addresses, normalizes into `QevieProtocolEvent`. `receipt-indexer` no-ops with a "not configured" flag when `receiptRegistry` is undefined (testnet). `domain-indexer` reads the resolver's service log store, not chain logs.
- `stats-aggregator.ts` — folds events into `ProtocolStatsResponse` + rolls `daily_protocol_stats` buckets (24h/7d volume). Separates `pending` vs `confirmed`.
- `index.ts` — `startIndexer()` poll loop (interval env, reuse the executor-loop style), wired into `paymaster-service/src/index.ts` startup behind `INDEXER_ENABLED !== "false"` so it can be disabled instantly (rollback lever).

Indexer is **additive and isolated**: it only reads chain logs and writes its own JSON stores. It touches no existing execution path.

---

## 4. Backend: API endpoints (added to `src/index.ts` routing, same style)
- `GET /api/protocol/stats?period=24h|7d|all` → `ProtocolStatsResponse` (serves this process's chain; `chainId` echoed; a `chainId` query that doesn't match returns `{ error, servedChainId }`, never another chain's data).
- `GET /api/protocol/events?limit=50&types=...` → recent `QevieProtocolEvent[]`.
- `GET /api/protocol/policies`, `/api/protocol/paymaster`, `/api/protocol/domains` → section slices.
- `GET /api/me/stats?smartAccount=0x...`, `GET /api/me/events?smartAccount=0x...&limit=...` → filtered to that smart account / owner only.
All return JSON; CORS handled like existing endpoints; empty/disabled states are explicit fields (`{ configured: false, reason }`), never zeros-as-fact.

---

## 5. SDK (`sdk/src/stats/`)
Add `qevie.stats` namespace on `QevieClient`: `getProtocolStats`, `getProtocolEvents`, `getPolicyStats`, `getPaymasterStats`, `getDomainStats`, `getMyStats`, `getMyEvents`. Reads from `config.statsApiUrl` (new optional config field). If unset: throw/return a clear `"Stats API is not configured for this network."` — never crash. Fully typed against `event-types.ts` shared shapes.

---

## 6. Frontend components & wiring
- `app/src/components/protocol/MiniLiveFeed.tsx`, `FullLiveFeed.tsx`, `ActivityFeedItem.tsx`, `KpiCard.tsx`, and lightweight CSS-only charts (`StatusRing.tsx`, `VolumeBars.tsx`, `ModeSplit.tsx`) — **no new chart dependency** (none installed; CSS/SVG transitions only, `prefers-reduced-motion` respected, pause-on-hover, no layout jank).
- `app/src/lib/statsClient.ts` — thin fetch wrapper to the stats API base URL from `app/src/config.ts` (new `VITE_STATS_API_URL`, defaults to the paymaster-service origin already used by the app).
- New page `pages/Protocol.tsx` + route `/protocol` in `App.tsx` (additive line; SPA fallback already covers deep links).
- Edit `Home.tsx` (proof strip section), `Dashboard.tsx` (personal section + link), `Autopilot.tsx` (policy stats block) — additive sections only; no existing markup removed.

---

## 7. Mainnet/testnet correctness
- Each paymaster-service process indexes exactly one chain → mainnet data and testnet data live in separate processes/stores and can never mix.
- The app labels the active network and, where a network lacks a contract (e.g. testnet ReceiptRegistry) or a resolver, shows the configured-false empty state.

---

## 8. Files to modify / add
**Add:** `paymaster-service/src/indexer/*` (8 files), SDK `sdk/src/stats/*` + export in `sdk/src/index.ts` + `statsApiUrl` in `client.ts`/`types.ts`, app `components/protocol/*`, `lib/statsClient.ts`, `pages/Protocol.tsx`, this doc, tests.
**Edit (additive):** `paymaster-service/src/index.ts` (routes + indexer start), `paymaster-service/src/config.ts` (store paths + env), `app/src/App.tsx` (route), `app/src/Home.tsx`/`Dashboard.tsx`/`Autopilot.tsx`, `app/src/config.ts`, `README.md`, `SECURITY.md`, `AGENTS.md`.
**Do NOT touch:** deployed contract addresses, existing execution/paymaster/session-key logic, existing routes/pages behavior.

---

## 9. Migration & rollback
- **Migration:** none for a DB (file stores auto-create on first write). First indexer run backfills from a configurable `INDEXER_START_BLOCK` (default: recent block to keep first sync fast) forward.
- **Rollback levers, in order:** (1) `INDEXER_ENABLED=false` stops indexing with zero impact on payments; (2) stats routes are isolated — removing them doesn't affect existing endpoints; (3) frontend sections are self-contained — revert the additive edits / rebuild; (4) git revert of the feature commits; (5) VPS `/var/www/qevie.backup-*` snapshots restore the previous static build.

---

## 10. Test plan
- **Indexer (paymaster-service):** indexes `AgentPolicyCreated`/`AgentPolicyRevoked`/`SessionExecution`/`ReceiptCreated`/paymaster events; aggregates daily QUSDC volume; separates pending vs confirmed; no double-count on `(txHash, logIndex)`; tolerates missing optional fields; filters by `chainId`; `/api/me/*` filters by `smartAccount`; receipt-indexer no-ops gracefully when `receiptRegistry` undefined.
- **SDK:** typed `getProtocolStats`; `getProtocolEvents` type filter; `getMyStats`/`getMyEvents` smartAccount filter; missing stats API → clear error; chain separation.
- **App:** proof strip renders 4 KPI cards; mini feed renders latest; `/protocol` renders KPIs + 5 tabs; connected dashboard shows user-only stats; Autopilot shows policy stats; empty/loading states; full feed pause-on-hover. (App has no unit-test runner today — add a minimal vitest setup or keep app tests as lightweight render checks; decide at implementation, noted as open item.)
- **Final gates:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r build`, `cd contracts && forge test`; grep for `fake|mock|stub|TODO|FIXME` and resolve anything outside tests/docs.

---

## 11. Explicitly deferred (needs separate approval)
Adding `GuardianApproved`, `AgentPolicyPaused/Resumed`, `PaymasterModeUsed(... userOpHash)` + native-fallback marker requires editing and **redeploying mainnet contracts** (new addresses, migration, re-verification). Per rule 0 this is not done silently. Until then those specific metrics render as "not emitted on-chain" / disabled — not faked.

---

## 12. Open questions for review (before coding)
1. **Route name:** `/protocol` (recommended, matches CTA copy) or `/stats`? Plan assumes `/protocol`.
2. **Contract event additions:** confirm these stay **out of scope** for now (no mainnet redeploy), accepting that GuardianApproved / on-chain pause / per-UserOp mode are shown as N/A/disabled. I recommend yes.
3. **App test runner:** add a minimal `vitest`/RTL setup to `app/` (currently none), or keep app coverage to SDK/indexer + manual render checks? I recommend adding a tiny vitest setup.
4. **Backfill depth:** how far back should the first mainnet index run start (`INDEXER_START_BLOCK`)? Affects first-sync time and historical totals. Default: from agentPolicyManager/receiptRegistry deploy block if known, else a recent block.
5. **Deploy timing:** build + redeploy to `/var/www/qevie` as part of this task, or hold the VPS deploy for your manual go-ahead after review?
