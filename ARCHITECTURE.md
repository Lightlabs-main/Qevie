# ARCHITECTURE.md

## Phase 1 Scope

Phase 1 builds the account abstraction core on QIE testnet:

1. audited EntryPoint v0.7 deployment
2. deterministic qevie smart accounts
3. account factory for counterfactual onboarding
4. no-trace bundler compatibility test

The app, SDK, paymaster, payment contracts, and Supabase-backed services are later phases.

## Smart Account

`QevieSmartAccount` is a minimal ERC-4337 account:

- one EOA owner signs UserOperations
- `validateUserOp` accepts the ERC-4337 v0.7 `PackedUserOperation`
- signatures are ERC-191 `signMessage` signatures over `userOpHash`
- calls can be executed one-by-one or atomically in a batch
- owner rotation is supported through a self-call
- native prefund is paid back to EntryPoint when needed

This account intentionally does not contain paymaster policy, subscriptions, or payment-specific rules. Those belong in later contracts.

## Factory

`QevieSmartAccountFactory` deploys accounts with CREATE2.

Counterfactual address inputs:

- factory address
- trusted EntryPoint address
- owner address
- salt
- account creation code

The first user action can include factory `initCode` so the account is deployed by EntryPoint without requiring native QIE in the user's EOA.

## EntryPoint

Phase 0 confirmed neither canonical EntryPoint address is deployed on QIE testnet or mainnet. Phase 1 must deploy audited eth-infinitism EntryPoint v0.7 from the official reference package and record the resulting addresses.

Do not reimplement EntryPoint locally.

## Bundler

Public QIE RPCs tested returned `debug_traceCall` unavailable. The initial bundler path uses Voltaire with `--unsafe --disable_p2p` for compatibility testing only.

GO/NO-GO remains pending:

- YES: if UserOperation validation and submission are stable on QIE testnet.
- NO: if bundler simulation is unstable without tracing, switch to the EIP-2771 relayer fallback behind the same SDK interface.
