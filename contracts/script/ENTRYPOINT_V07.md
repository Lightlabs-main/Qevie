# EntryPoint v0.7 Deployment Runbook

Phase 0 confirmed both canonical EntryPoint addresses are empty on QIE testnet and mainnet.

Deploy the audited eth-infinitism EntryPoint v0.7 from the official reference repo/package. Do not copy the EntryPoint source into qevie as original code.

## Testnet Steps

1. Install the official eth-infinitism account-abstraction release for v0.7.0 under `contracts/lib`.
2. Install OpenZeppelin Contracts v5.0.0 under `contracts/lib`.
3. Deploy EntryPoint v0.7.0 to QIE testnet using `script/DeployEntryPoint.s.sol`.
4. Verify bytecode/source on `https://testnet.qie.digital/`.
5. Record the address in the root `README.md`.
6. Export it as `ENTRYPOINT_ADDRESS` before deploying `QevieSmartAccountFactory`.

## Required Environment

```sh
export QIE_TESTNET_RPC=https://rpc1testnet.qie.digital/
export TESTNET_PRIVATE_KEY=...
```

The deployer must be funded with QIE testnet gas.
