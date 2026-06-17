
# SECURITY.md

## Deployment Status

Qevie runs on QIE mainnet (chain id `1990`, RPC `https://rpc1mainnet.qie.digital/`).
The EntryPoint, smart-account factory, paymaster, bundler, AgentPolicyManager
(Autopilot session policies), SubscriptionManager, ReceiptRegistry, and the
read-only stats indexer are deployed. A testnet deployment (chain id `1983`)
mirrors mainnet for testing.

The contracts are non-custodial: neither the paymaster nor any Qevie service
holds user QUSDC, and every spend is bounded by the smart-account, session-policy,
and paymaster validation described below.

## Smart Account Controls

- Only the trusted EntryPoint or owner can execute calls.
- `validateUserOp` rejects non-EntryPoint callers.
- Bad UserOperation signatures return `SIG_VALIDATION_FAILED` (`1`) instead of reverting.
- `execute` and `executeBatch` use a reentrancy guard.
- Batch execution is atomic because any failed call reverts the full batch.
- Owner rotation rejects the zero address.
- ECDSA validation rejects malleable high-`s` signatures and invalid `v` values.

## Known Risks & Limitations

- The account is single-owner for the wallet owner. Delegated automation is
  added through scoped **session keys** governed by AgentPolicyManager (see
  "Agent-native execution safety"), not by widening owner authority. Multisig and
  social recovery remain out of scope.
- UserOperation signing uses ERC-191 `signMessage` over the EntryPoint
  `userOpHash`; SDK work must preserve this exact scheme unless the account is
  upgraded deliberately.
- Public QIE RPCs lack `debug_traceCall`, so the bundler runs in unsafe/no-trace
  mode. Paymaster and policy validation therefore guard against the abuse a
  tracing bundler would otherwise reject.
- `eth_estimateGas` on QIE returns an intrinsic-only estimate, so the SDK sets
  explicit gas limits and verifies receipts rather than trusting the estimate.

## Operational Security Requirements

- Only the audited eth-infinitism v0.7 EntryPoint implementation is used.
- The sponsored tier must keep hard per-account, daily, and global caps with
  Sybil gating; it is never unlimited free gas.
- Paymaster funding stays adversarially tested; QUSDC_GAS pricing requires a
  fresh, liquid QIEDex route before any gas is fronted.
- Mainnet contract deployments are verified on `https://mainnet.qie.digital/`.
- Static analysis (Slither or equivalent) and external review precede contract
  changes.

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

## Stats Integrity

Protocol stats are derived from confirmed on-chain events and clearly
service-sourced records — never fabricated.

- Volume, policy counts, executions, paymaster usage, and receipts come from
  confirmed contract events. Pending and failed events are tracked separately and
  never counted as confirmed volume or active state. The volume model is
  deliberately non-overlapping so no payment is double-counted.
- The dashboard must not display fake volume, fake receipts, fake policy counts,
  fake activity events, or fake transaction hashes. Metrics the deployed
  contracts do not emit (guardian *approvals*, on-chain pause state, per-UserOp
  paymaster mode) are surfaced as "not emitted on-chain", not as a fabricated 0.
- Global protocol stats (`/api/protocol/*`) and connected-user stats
  (`/api/me/*`) are kept strictly separate so a user is never shown protocol-wide
  totals as if they were their own.
- Each stats service process indexes exactly one chain; a request naming a
  different `chainId` is refused with the chain actually served, so mainnet data
  can never be presented as testnet data (or vice-versa).
- The indexer only reads chain logs and writes its own JSON stores. It never
  touches payment execution, session keys, or the paymaster, and can be disabled
  with `INDEXER_ENABLED=false` with zero impact on payment flows.
