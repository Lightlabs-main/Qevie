# Passport / Receipts Implementation Plan

## Existing files reused

- `contracts/src/payments/BatchPayments.sol`
- `contracts/src/payments/PaymentRequest.sol`
- `contracts/src/subscriptions/SubscriptionManager.sol`
- `sdk/src/client.ts`
- `sdk/src/abis.ts`
- `sdk/src/types.ts`
- `app/src/pages/Send.tsx`
- `app/src/pages/PaymentLinks.tsx`
- `app/src/pages/Profile.tsx`
- `app/src/config.ts`
- `paymaster-service/src/index.ts`
- `paymaster-service/src/config.ts`

## New files to add

- `contracts/src/receipts/ReceiptRegistry.sol`
- `contracts/test/ReceiptRegistry.t.sol`
- `app/src/pages/Passport.tsx`
- `app/src/pages/ReceiptDetail.tsx`
- `app/src/pages/Developers.tsx`
- SDK receipt/passport helper modules if needed

## Safest integration strategy

1. Fix current history RPC regression first by paging `eth_getLogs` / contract event reads under the QIE RPC 10k block limit.
2. Add a standalone `ReceiptRegistry` contract with tests. Do not change existing payment contracts yet.
3. Extend the SDK with optional receipt-registry support and Passport aggregation methods.
4. Add app pages for Passport, Receipt detail, and Developers. These must degrade cleanly when `receiptRegistry` is not configured.
5. Add best-effort automatic receipt creation after successful payments through a service/issuer path. Payment success must not be downgraded to failure if receipt issuance fails.

## What will not be changed

- Existing gasless payment execution model
- Existing paymaster sponsorship logic
- Existing username flow
- Existing request / batch / subscription contract semantics
- Existing deployed addresses in verified config

## Risks / blockers

- `ReceiptRegistry` is not yet deployed or verified on QIE. It must stay optional in shipped config until deployed.
- Authorized-issuer receipt creation requires either a trusted backend signer or direct contract integration later.
- Passport stats must come from receipts once the registry is deployed; until then, the UI must clearly report that receipts are unavailable on the current network.
- Public QIE RPC log range is capped, so all event indexing paths must page requests.
