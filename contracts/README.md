# @qevie/contracts

Foundry contracts for qevie.

## Build And Test

```sh
forge build --offline
forge test --offline --force
forge lint
forge fmt --check
```

Use `--offline` for tests in this environment. Without it, the installed Foundry build can panic while creating its OpenChain signature lookup client on macOS.

## Deploy Phase 1 EntryPoint And Factory

Deploy audited eth-infinitism EntryPoint v0.7.0 from `lib/account-abstraction`:

```sh
export QIE_TESTNET_RPC=https://rpc1testnet.qie.digital/
export TESTNET_PRIVATE_KEY=...

forge script script/DeployEntryPoint.s.sol:DeployEntryPoint \
  --rpc-url "$QIE_TESTNET_RPC" \
  --broadcast
```

Record the EntryPoint address in the root `README.md`, then deploy the qevie factory:

```sh
export ENTRYPOINT_ADDRESS=...

forge script script/DeployFactory.s.sol:DeployFactory \
  --rpc-url "$QIE_TESTNET_RPC" \
  --broadcast
```

Record the factory address in the root `README.md`.
