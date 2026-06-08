# qevie

Gas-abstracted stablecoin payments on QIE using ERC-4337 smart accounts, QUSDC, a Qevie paymaster, and a bundled mobile-first PWA.

Qevie does not make gas disappear — it abstracts it. The first 3 actions per account are sponsored for onboarding; after that you pay the network fee in QUSDC (see [Gas Model](#gas-model)).

---

## ⭐ Core Features

Qevie has two headline features that make stablecoin payments on QIE feel like a
normal app:

### 1. The Qevie USDC Paymaster

Qevie runs its **own ERC-4337 paymaster**. Users never have to hold native QIE:

- **Sponsored onboarding** — the first 3 actions per smart account are sponsored
  by Qevie (a strict onboarding quota, not unlimited free gas).
- **Pay gas in USDC** — after onboarding, the paymaster fronts the native QIE gas
  and charges the user in **QUSDC**, priced live along the QIEDex WQIE→QUSDC route.
  The recipient gets the full amount; the sender pays the amount plus a few
  hundredths of a cent of gas, all in USDC.
- **Sustainable** — because users pay their own gas in USDC, the model works on
  mainnet as a **full USDC paymaster** (no sponsored tier) without Qevie
  subsidising gas forever.

You hold USDC, you transact. No USDC, no transaction — it's a payment app.

### 2. Qevie Autopilot — Agentic Payments

Qevie ships **real, unattended payment agents** (not LLM prompts, **no API key**):

- A user authorises an on-chain **AgentPolicy** (allowed recipients, per-tx /
  daily / weekly / total caps, expiry, guardian revoke, and a gas policy).
- Qevie provisions a **server-custodied session key** (AES-256-GCM encrypted at
  rest) — non-technical users never handle a key.
- An **unattended executor** signs due payments with that key and settles them
  on-chain, with no human in the loop per payment.
- Agents are **funds-aware**: they verify the account can afford the payment plus
  the USDC gas fee **before scheduling**, and **pause** instead of submitting
  payments that cannot be funded.

The agents are deterministic and policy-bound — every action is enforced on-chain.

---

## What Is Built

Qevie currently includes:

- ERC-4337 smart accounts for each user (EntryPoint v0.7 on QIE testnet)
- **Qevie USDC paymaster** — sponsored onboarding then pay-gas-in-USDC
- **Qevie Autopilot** — server-custodied session keys + unattended executor agent
- Voltaire bundler wired to the deployed QIE EntryPoint
- QUSDC send flow, batch payments, payment requests
- subscriptions plus a keeper loop
- username registration and reverse lookup
- payment links and QR flows
- ReceiptRegistry + Qevie Passport (portable payment reputation)
- mobile PWA frontend
- a TypeScript SDK (`@qevie/sdk`) for QIE builders
- VPS deployment with PM2-managed app, bundler, and paymaster services

This is a working, deployed gas-abstracted stablecoin payment stack, not just a contract repo.

## Gas Model

Qevie has its own paymaster. Qevie does not claim unlimited free gas:

- The first 3 actions per account are sponsored for onboarding.
- After that, the user pays the network fee in QUSDC.
- No QUSDC means no transaction — Qevie is a payment app, so the user simply
  adds QUSDC to continue.

On testnet the sponsored onboarding tier is enabled. On mainnet Qevie runs as a
full USDC paymaster: every action pays gas in QUSDC.

Qevie Autopilot follows the same model. Agents check that the account can afford
the payment plus the QUSDC gas fee before scheduling, and pause instead of
submitting payments that cannot be funded.

## Account Model

Qevie uses two addresses per user:

- `QIE Wallet`: the connected owner wallet. It signs messages and UserOperations.
- `Qevie Smart Account`: the app account controlled by the QIE Wallet. It sends, receives, registers usernames, and executes sponsored actions.

Why this exists:

- the owner wallet is identity and authorization
- the smart account is execution
- the paymaster sponsors gas for the smart account

As a result:

- the smart account can have `0` native QIE and still work
- explorer activity may appear under `EntryPoint.handleOps`
- the balance that matters for payments is usually `QUSDC`

## Current User-Facing Features

### Wallet

The wallet screen now shows:

- connected `QIE Wallet` address
- `Qevie Smart Account` address
- owner wallet `QUSDC` balance
- owner wallet native `QIE` balance
- smart account `QUSDC` balance
- smart account native `QIE` balance
- gas sponsorship status

The UI explicitly explains:

- `QIE Wallet signs`
- `Qevie Smart Account pays and receives`
- `Sponsored by Qevie Paymaster`

### Profile

The profile flow now supports:

- username registration through the smart account
- reverse lookup of the already-registered username on load
- showing the registered username instead of leaving the form in an ambiguous state
- QR display for either the username or the smart account address
- copy action that copies the registered username when present

The profile screen is intended to behave as the receive identity screen.

### Send

The send flow currently supports:

- recipient resolution from address, username, or `.qie` name
- `QUSDC` transfer through the smart account
- a live **gas panel**: sponsored onboarding while quota remains, then the
  estimated USDC gas fee, then a clear "add USDC" prompt if the user can't pay
- automatic arming of the USDC-gas approval during onboarding
- success state with explorer link

### Payment Links and QR

The app can generate:

- single payment links
- split payment links
- QR codes for links
- shareable `qevie:`-style payment payloads routed through the app

### Requests, Batch Pay, and Subscriptions

The repo also includes:

- payment request contract + UI flow
- batch payment contract + UI flow
- subscription manager contract + keeper-backed execution path

## Architecture

Core layers:

- `contracts/`: on-chain account, paymaster, payment, subscription, and registry contracts
- `sdk/`: account abstraction client, bundler client, resolution, links, and React hooks
- `app/`: React PWA frontend
- `paymaster-service/`: allowlist-token API and recurring execution worker
- `infra/`: bundler configuration and operational notes

### Smart Account

Primary contract:

- [`contracts/src/account/QevieSmartAccount.sol`](contracts/src/account/QevieSmartAccount.sol)

Responsibilities:

- validate ERC-4337 UserOperations
- execute calls from the owner or EntryPoint
- serve as the programmable payment account

### Paymaster

Primary contract:

- [`contracts/src/paymaster/QeviePaymaster.sol`](contracts/src/paymaster/QeviePaymaster.sol)

Responsibilities:

- **Mode B (sponsored onboarding)** — sponsor gas for the first 3 ops per account,
  Sybil-gated by an allowlist token and scoped to whitelisted Qevie targets, with
  per-account / daily / global budget caps.
- **Mode A (USDC gas)** — front native QIE gas and charge the user in QUSDC,
  priced from the QIEDex WQIE/QUSDC pair plus a configurable markup, with a price
  staleness + minimum-liquidity guard.
- expose read-only views so the app/agents show an honest gas state:
  `remainingFreeOps(account)`, `qusdcGasAvailable(account, maxGasCostWei)`,
  `getQusdcGasStatus()`.
- owner controls: pause, QUSDC-gas enable/disable, markup, and optional
  per-tx / daily USDC-gas safety ceilings (default unlimited).

### SDK

Primary client:

- [`sdk/src/client.ts`](sdk/src/client.ts)

Important methods already implemented:

Payments & identity:
- `pay()` / `paySubmit()`, `batchPay()`, `requestPayment()` / `payRequest()`
- `subscribe()` / `cancelSubscription()`
- `registerUsername()`, recipient `resolve()`

Gas model (`client.gas`):
- `getSponsoredStatus(smartAccount)` — remaining onboarding quota
- `quoteQusdcGas(smartAccount)` — whether USDC gas is available + the quote
- `getGasModeOptions(smartAccount)` / `resolveGasMode(...)`
- `client.ensureQusdcGasReady(signer)` — arm the one-time paymaster approval so
  USDC gas works after onboarding

Autopilot (`client.agent`):
- `createSessionPolicy()`, `listSessionPolicies()`, `getSessionPolicy()`
- `executeAutopilotPayment()`
- `getAutopilotGasStatus(policyId)` — structured gas decision for a policy

Receipts & Passport:
- `receipts.createReceipt()` / `getReceipt()` / `listFor*()`
- `passport.getPassport()` / `getStats()`

### Service Layer

Primary service:

- [`paymaster-service/src/index.ts`](paymaster-service/src/index.ts)

Recurring execution worker:

- [`paymaster-service/src/keeper.ts`](paymaster-service/src/keeper.ts)

Current service responsibilities:

- allowlist token issuance (sponsored onboarding)
- recurring subscription charging (keeper)
- **Autopilot**: session-key custody, intent scheduling with the affordability
  check, and the unattended executor that settles agent payments
  ([`autopilot-executor.ts`](paymaster-service/src/autopilot-executor.ts),
  [`session-keys.ts`](paymaster-service/src/session-keys.ts))
- testnet QIEDex price heartbeat so USDC-gas quotes stay fresh

## Qevie Autopilot — Agentic Payments (built)

Autopilot lets a Qevie smart account make automatic (scheduled / recurring) USDC
payments without the user signing each one, bounded entirely by an on-chain
policy. There is **no LLM and no API key** — the "agents" are deterministic
policy-enforcement code.

### How it works

1. **Policy** — the user creates an on-chain `AgentPolicy`
   ([`AgentPolicyManager.sol`](contracts/src/agent/AgentPolicyManager.sol)) with:
   allowed recipients, `maxPerTx` / `dailyLimit` / `weeklyLimit` / `totalLimit`,
   `validAfter` / `validUntil`, a guardian (defaults to the owner wallet, who can
   revoke), and a **gas policy** (sponsored / QUSDC / pause).
2. **Session key** — `POST /session-key` mints a keypair whose private key is
   **encrypted at rest (AES-256-GCM)** and never leaves the service.
   ([`session-keys.ts`](paymaster-service/src/session-keys.ts))
3. **Schedule** — `POST /autopilot/intent` enqueues a payment. At this point the
   **affordability agent** re-checks the policy on-chain and confirms the account
   can cover the payment **plus the USDC gas fee**, rejecting it up front
   otherwise.
4. **Execute** — an unattended poll loop
   ([`autopilot-executor.ts`](paymaster-service/src/autopilot-executor.ts)) loads
   due intents, re-validates the policy, picks the gas mode (sponsored while the
   onboarding quota remains → else USDC gas, else **pause**), signs with the
   custodied key, and settles on-chain via the SDK.

### Safety properties

- Every payment is bounded by the on-chain policy caps and the allowed-recipient
  list — the session key cannot pay anyone else or exceed the caps.
- The guardian (the owner wallet) can revoke a policy at any time.
- Agents **pause instead of spamming** failing UserOperations when no gas route or
  no funds exist.
- The gas mode used on each run is recorded and shown in the activity list.

### API surface

```txt
POST /session-key          { smartAccount }            -> { sessionKey }
POST /autopilot/intent     { smartAccount, policyId,
                             recipient, amount,
                             intervalSeconds?, maxRuns?,
                             startAt? }                 -> intent (or 4xx if unaffordable)
GET  /autopilot/intents    ?smartAccount=0x..          -> { intents: [...] }
POST /autopilot/cancel     { id }                       -> { ok }
```

## Current Deployment

QIE testnet chain ID: `1983`

Public endpoints:

- App: `https://qevie.duckdns.org`
- Paymaster service: `https://qevie.duckdns.org/paymaster`
- Bundler RPC: `https://qevie.duckdns.org/bundler/rpc`

VPS source and deploy paths:

- source repo: `/opt/qevie`
- built frontend: `/var/www/qevie`

## Qevie Passport

Qevie Passport turns gasless QUSDC payments into portable payment reputation.

Every successful Qevie payment can create a verifiable receipt through the `ReceiptRegistry`. The Passport page aggregates those receipts into a user or merchant profile showing verified payment activity.

Qevie Passport is not a credit score. It is a proof-of-payment profile that can show:

- verified receipts
- payments sent and received
- merchant payments received
- completed subscriptions
- batch payouts
- QUSDC volume, if the user chooses to show it
- downloadable receipt JSON

This gives QIE users and merchants reusable payment reputation across apps.

## Developer SDK

Qevie exposes a TypeScript SDK for QIE builders who want to add gasless QUSDC payments, receipts, and Passport stats.

Example:

```ts
import { createQevieClient } from "@qevie/sdk";

const qevie = createQevieClient({ chainId: 1990, rpcUrl, bundlerUrl, paymasterServiceUrl, contracts });

await qevie.pay(signer, {
  to: "0xRecipient",
  amount: BigInt(10_000_000),
  memo: "Thanks",
});

const passport = await qevie.passport.getPassport("0xMerchant");
```

PM2 process names:

- `qevie-app`
- `qevie-paymaster`
- `qevie-bundler`

## Testnet Contracts

The SDK source of truth is [`sdk/src/contracts.ts`](sdk/src/contracts.ts).

Current QIE testnet (chain `1983`) addresses:

- EntryPoint: `0xa07d2Ff33400fbE2c741385cb959D5BCbA041493`
- Account factory: `0xF4cB7EB568cca9714aD3A6adCAFAaBFB39eA6E14`
- **Paymaster: `0x082022A246b899C216Ba9e0ea339c8E7C8a4D0b4`**
- **AgentPolicyManager: `0x5E0FABf9aD44a21A38775942a1041c55fbAAE89A`**
- Batch payments: `0xb07fff088D37355EAD2f4226e208DAA32f7b6a19`
- Payment request: `0x9ee2d86248F3811E6e63d7C7F025E717AAE877aB`
- Subscription manager: `0x0705e239bF3F8250DADA4aad1051C33C32fb988a`
- Username registry: `0x82f50077a8cB6988DF4bBB9B8BD9f92F95975bF4`
- Test QUSDC: `0x850E073f0E7536A03fE22DB0CFBeA08e6DB3e18f`
- QIEDex pair (WQIE/QUSDC): `0xd94975d051634C4422D84dA9D4D89DC9Fb00DC5F`

## VPS Operations

### Deploy frontend

```sh
cd /opt/qevie
pnpm --filter @qevie/sdk build
pnpm --filter @qevie/app typecheck
pnpm --filter @qevie/app build
rm -rf /var/www/qevie/*
cp -a /opt/qevie/app/dist/. /var/www/qevie/
pm2 restart qevie-app
```

### Health checks

```sh
curl http://127.0.0.1:3001/health
curl -X POST http://127.0.0.1:4337/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
curl -I http://127.0.0.1:8080/
pm2 list
```

## Known Infrastructure Notes

QIE public RPC does not expose `debug_traceCall`, so the VPS Voltaire bundler runs in unsafe or no-trace mode.

QIE simulation responses also required local compatibility patches inside the VPS Voltaire environment so plain `execution reverted` responses from QIE RPC do not block otherwise valid UserOperations.

Practical consequence:

- bundler-side simulation is less standard than on major EVM networks
- on-chain `EntryPoint.handleOps` remains the real enforcement point

## Local Development

Install dependencies:

```sh
pnpm install
```

Build all packages:

```sh
pnpm -r build
```

Typecheck:

```sh
pnpm -r typecheck
```

Contracts:

```sh
pnpm contracts:build
pnpm contracts:test
```

## Important Files

- [`app/src/pages/Send.tsx`](app/src/pages/Send.tsx) · [`app/src/lib/gasless.ts`](app/src/lib/gasless.ts) · [`app/src/lib/useGasStatus.ts`](app/src/lib/useGasStatus.ts)
- [`app/src/pages/AutopilotPolicies.tsx`](app/src/pages/AutopilotPolicies.tsx) · [`app/src/pages/AutopilotNew.tsx`](app/src/pages/AutopilotNew.tsx)
- [`sdk/src/client.ts`](sdk/src/client.ts) · [`sdk/src/gas.ts`](sdk/src/gas.ts)
- [`paymaster-service/src/autopilot-executor.ts`](paymaster-service/src/autopilot-executor.ts) · [`paymaster-service/src/session-keys.ts`](paymaster-service/src/session-keys.ts)
- [`contracts/src/paymaster/QeviePaymaster.sol`](contracts/src/paymaster/QeviePaymaster.sol)
- [`contracts/src/agent/AgentPolicyManager.sol`](contracts/src/agent/AgentPolicyManager.sol)
- [`contracts/src/account/QevieSmartAccount.sol`](contracts/src/account/QevieSmartAccount.sol)

## Status

The current repo and VPS reflect a functioning, deployed QIE testnet payment
application with:

- ERC-4337 smart accounts
- the **Qevie USDC paymaster** — sponsored onboarding then pay-gas-in-USDC
- **Qevie Autopilot** — server-custodied agents making unattended USDC payments
- QUSDC transfer, batch, request, and subscription flows
- username identity, QR and link-based payment flows
- ReceiptRegistry + Qevie Passport reputation
- a TypeScript SDK for QIE builders

Both core features — the USDC paymaster and the Autopilot agents — are live on the
testnet deployment and verified end-to-end against the deployed bundler,
paymaster, and executor.
