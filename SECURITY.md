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

## Receipt and Passport Security

The ReceiptRegistry does not custody funds and cannot move user tokens. It only records verified payment receipts.

Receipt creation is restricted to authorized Qevie issuers/contracts to reduce spam and reputation manipulation.

Qevie Passport is a reputation and receipt aggregation layer, not a credit score or financial guarantee.

Privacy limitations:

- On-chain data is public.
- UI-level hidden amounts do not erase underlying chain data if emitted.
- Users should avoid putting sensitive memos directly on-chain.
- Metadata should be hashed, and private details should remain off-chain.

Qevie Passport is not a zero-knowledge privacy system. Receipt hashes and on-chain receipt events are public. Users can choose to hide amounts and memos from the Qevie UI/export layer, but any data emitted on-chain may be publicly observable. Future versions may support encrypted metadata or ZK/private receipts.

## Paymaster Gas Modes

The Qevie Paymaster is not unlimited free gas.

Sponsored onboarding is capped at 3 eligible transactions per smart account
(`PER_ACCOUNT_CAP`, a lifetime per-account quota, plus daily/global QIE budgets).
It cannot be reset by reconnecting a wallet, only sponsors calls to whitelisted
Qevie targets, and is intended only to bootstrap a new account.

After the onboarding quota, users pay gas in QUSDC. QUSDC_GAS mode pays native
QIE gas from the paymaster's EntryPoint deposit and recovers the cost in QUSDC.
It requires, and the paymaster validates before fronting gas:

- a verified QIEDex WQIE/QUSDC pricing route, with a freshness (staleness) check
  and a minimum-liquidity check to reject thin/manipulable pools;
- the user holds enough QUSDC and has approved the paymaster (`transferFrom`
  allowance), checked at validation time before the op executes;
- optional owner-set safety ceilings: `maxQusdcGasPerTx` and `dailyQusdcGasCap`
  (both default to unlimited — a funded user can always pay gas in QUSDC);
- a pricing markup (`gasMarkupBps`, default 20%) so the paymaster does not lose
  value to short-term price movement;
- an owner pause switch (`pause()`) and a QUSDC_GAS master switch
  (`qusdcGasEnabled`).

Because the QUSDC approval must exist before the first QUSDC_GAS op (the
allowance is checked during validation, before execution), Qevie arms the
approval with a sponsored op during onboarding. On mainnet, where there is no
sponsored tier, accounts must approve the paymaster as part of setup.

Autopilot must pause when no valid gas route exists, and agents verify the
account can afford the payment plus the QUSDC gas fee before scheduling, rather
than submitting failing UserOperations.

## Agent-native execution safety

Agent-native does not mean unrestricted execution.

Autopilot agents can only execute inside AgentPolicyManager limits:

- allowed recipients (stored on-chain as resolved addresses)
- token restrictions (QUSDC-only)
- per-tx / daily / weekly / total spend caps
- expiry
- gas behaviour (sponsored / QUSDC / native / pause)
- guardian revocation

Natural-language Agent Commands only ever produce **tool plans** over the
existing rails; they never bypass policy. In manual-approval mode the user
approves the previewed rail; in Autopilot mode the action runs only if an
on-chain policy already allows the resolved recipient and amount. Manual payment
rails remain available as fallback and override paths.

## QIE Domain Resolver safety

QIE Domains improve UX but do not replace policy enforcement.

- Autopilot resolves `.qie` recipients **before** policy creation and stores the
  **resolved address** on-chain. If a domain changes later, an existing policy
  does **not** automatically redirect to the new address. This prevents silent
  recipient redirection.
- The Guardian validates resolved addresses; the Executor always pays the address
  locked on the policy/intent and never re-resolves a domain to override it.
- Forward resolution is only attempted when a resolver is explicitly configured
  and is reverse-verified against the registry where possible. With no resolver
  configured, `.qie` forward resolution is cleanly unavailable — Qevie never
  fabricates an address, a transaction hash, a receipt, or a resolution.
