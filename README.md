# qevie / passpay

Gasless stablecoin payments on QIE mainnet, plus a framework-agnostic TypeScript SDK.

Current phase: Phase 1 AA core on QIE testnet.

## Phase 1 Status

- Phase 0 verification is recorded in `VERIFICATION.md`.
- ERC-4337 v0.7 EntryPoint is not deployed on QIE testnet or mainnet yet.
- Qevie smart account and deterministic factory are implemented under `contracts/`.
- The factory deploy script is ready once `ENTRYPOINT_ADDRESS` is known.
- Public QIE RPCs tested do not expose `debug_traceCall`; bundler testing starts in unsafe/no-trace mode.

## Commands

```sh
pnpm -r build
pnpm -r test
pnpm -r lint
```

Contracts only:

```sh
cd contracts
forge build --offline
forge test --offline --force
forge lint
forge fmt --check
```

## Original vs Infrastructure Code

Original qevie code in this repo:

- `contracts/src/account/QevieSmartAccount.sol`
- `contracts/src/account/QevieSmartAccountFactory.sol`
- Phase 1 deploy/runbooks and tests

Standard infrastructure expected but not copied into this repo:

- audited eth-infinitism EntryPoint v0.7
- off-the-shelf ERC-4337 bundler, currently Voltaire for the no-trace test path

## Required Before Testnet Deployment

1. Fund a testnet deployer with QIE testnet gas from `https://www.qie.digital/faucet`.
2. Set `TESTNET_PRIVATE_KEY` in `.env`.
3. Deploy audited eth-infinitism EntryPoint v0.7 to QIE testnet.
4. Record the deployed EntryPoint address in `VERIFICATION.md` and `.env`.
5. Deploy `QevieSmartAccountFactory`.
6. Start the bundler and attempt a first UserOperation.
