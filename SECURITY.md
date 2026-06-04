# SECURITY.md

## Phase 1 Security Notes

This phase does not deploy a paymaster and does not custody user funds beyond whatever a smart account owner sends to their account for testing.

## Smart Account Controls

- Only the trusted EntryPoint or owner can execute calls.
- `validateUserOp` rejects non-EntryPoint callers.
- Bad UserOperation signatures return `SIG_VALIDATION_FAILED` (`1`) instead of reverting.
- `execute` and `executeBatch` use a reentrancy guard.
- Batch execution is atomic because any failed call reverts the full batch.
- Owner rotation rejects the zero address.
- ECDSA validation rejects malleable high-`s` signatures and invalid `v` values.

## Known Phase 1 Risks

- The account is single-owner. Multisig/recovery/session keys are out of scope for Phase 1.
- UserOperation signing currently uses ERC-191 `signMessage` over the EntryPoint `userOpHash`; SDK work must preserve this exact scheme unless the account is upgraded deliberately.
- Public QIE RPCs lack `debug_traceCall`. Bundler unsafe/no-trace mode is for testnet compatibility testing, not a final security posture.
- EntryPoint has not been deployed yet. Only deploy the audited eth-infinitism v0.7 implementation.

## Required Before Mainnet

- External review of account and factory.
- Paymaster adversarial tests before any paymaster funding.
- Slither or equivalent static analysis.
- Mainnet deployments verified on `https://mainnet.qie.digital/`.
- No sponsored free tier without hard caps and Sybil gating.
