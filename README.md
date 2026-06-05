# qevie

Gasless stablecoin payments on QIE using ERC-4337 smart accounts, QUSDC, a Qevie paymaster, and a bundled mobile-first PWA.

## What Is Built

Qevie currently includes:

- ERC-4337 smart accounts for each user
- EntryPoint v0.7 flow on QIE testnet
- Qevie paymaster for sponsored gas
- Voltaire bundler wired to the deployed QIE EntryPoint
- QUSDC send flow
- batch payments
- payment requests
- subscriptions plus a keeper loop
- username registration and reverse lookup
- payment links and QR flows
- mobile PWA frontend
- VPS deployment with PM2-managed app, bundler, and paymaster services

This is a working gasless stablecoin payment stack, not just a contract repo.

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
- gasless `QUSDC` transfer through the smart account
- paymaster-assisted execution
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

- sponsor gas for allowed operations
- enforce paymaster policy
- support allowlist-token-based sponsored usage

### SDK

Primary client:

- [`sdk/src/client.ts`](sdk/src/client.ts)

Important methods already implemented:

- `pay()`
- `batchPay()`
- `requestPayment()`
- `subscribe()`
- `cancelSubscription()`
- `registerUsername()`
- recipient `resolve()`

### Service Layer

Primary service:

- [`paymaster-service/src/index.ts`](paymaster-service/src/index.ts)

Recurring execution worker:

- [`paymaster-service/src/keeper.ts`](paymaster-service/src/keeper.ts)

Current service responsibilities:

- allowlist token issuance
- sponsorship support
- recurring subscription charging

## Agentic Payments Integration Path

Qevie is already structurally compatible with agentic payments because it has:

- a programmable smart account
- a paymaster
- a bundler
- backend execution infrastructure
- SDK payment primitives

The recommended model is:

- the agent proposes
- the user approves
- the smart account executes

This should be added as a service-layer feature, not as a separate wallet.

Recommended phases:

1. agent-created payment requests
2. one-off approved agent payments
3. scoped spending approvals
4. scheduled or conditional agent execution

Recommended implementation shape:

- intent records in the backend
- approval UI in the app
- execution worker in `paymaster-service`
- reuse of existing SDK methods for on-chain execution

The existing subscription keeper is the correct starting point for future agent execution.

## Current Deployment

QIE testnet chain ID: `1983`

Public endpoints:

- App: `https://qevie.duckdns.org`
- Paymaster service: `https://qevie.duckdns.org/paymaster`
- Bundler RPC: `https://qevie.duckdns.org/bundler/rpc`

VPS source and deploy paths:

- source repo: `/opt/qevie`
- built frontend: `/var/www/qevie`

PM2 process names:

- `qevie-app`
- `qevie-paymaster`
- `qevie-bundler`

## Testnet Contracts

The SDK source of truth is [`sdk/src/contracts.ts`](sdk/src/contracts.ts).

Current QIE testnet addresses:

- EntryPoint: `0xa07d2Ff33400fbE2c741385cb959D5BCbA041493`
- Account factory: `0x9E87eBcde02fc7c3729863D7C371030F8101E7CE`
- Paymaster: `0x1cdD6BC4258F590E0ea2b10E82a8162384d7f5f2`
- Username registry: `0x82f50077a8cB6988DF4bBB9B8BD9f92F95975bF4`
- Test QUSDC: `0x850E073f0E7536A03fE22DB0CFBeA08e6DB3e18f`

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

- [`app/src/pages/Dashboard.tsx`](app/src/pages/Dashboard.tsx)
- [`app/src/pages/Profile.tsx`](app/src/pages/Profile.tsx)
- [`app/src/pages/Send.tsx`](app/src/pages/Send.tsx)
- [`app/src/pages/PaymentLinks.tsx`](app/src/pages/PaymentLinks.tsx)
- [`sdk/src/client.ts`](sdk/src/client.ts)
- [`paymaster-service/src/keeper.ts`](paymaster-service/src/keeper.ts)
- [`contracts/src/account/QevieSmartAccount.sol`](contracts/src/account/QevieSmartAccount.sol)
- [`contracts/src/paymaster/QeviePaymaster.sol`](contracts/src/paymaster/QeviePaymaster.sol)
- [`contracts/src/registry/UsernameRegistry.sol`](contracts/src/registry/UsernameRegistry.sol)

## Status

The current repo and VPS reflect a functioning QIE testnet payment application with:

- ERC-4337 smart accounts
- paymaster-sponsored gas
- QUSDC transfer flows
- username identity
- QR and link-based payment flows
- subscription infrastructure
- a clearer wallet and profile UX

The next major system extension is agentic payment approvals and execution on top of the existing smart account and service stack.
