# QIE Testnet Bundler

Phase 0 confirmed `debug_traceCall` is unavailable on tested public QIE RPCs. This runbook starts Voltaire in unsafe/no-trace mode for the Phase 1 GO/NO-GO compatibility test.

This is not the final production bundler posture.

## Start

```sh
export QIE_TESTNET_RPC=https://rpc1testnet.qie.digital/
export BUNDLER_SECRET=replace-with-funded-testnet-private-key
export BUNDLER_PORT=4337
export BUNDLER_LOGS_INCREMENTAL_RANGE=10000
export BUNDLER_LOGS_NUMBER_OF_RANGES=2

docker compose -f infra/bundler/docker-compose.yml up
```

The bounded log range is required for QIE. Voltaire's default receipt lookup
queries `eth_getLogs` from `earliest` to `latest`; QIE times out when scanning
the full chain, leaving mined UserOperations stuck without a bundler receipt.
The defaults above scan two recent 10,000-block ranges instead.

## Test

After EntryPoint and the factory are deployed, send a minimal UserOperation that:

1. uses factory `initCode` for a counterfactual `QevieSmartAccount`
2. calls `execute(target, value, data)`
3. is signed with ERC-191 `signMessage(userOpHash)`

After submission, poll `eth_getUserOperationReceipt` and confirm the bundler
returns the mined receipt promptly. A transaction appearing on-chain is not
enough to verify the receipt path.

If Voltaire cannot reliably simulate and submit on QIE testnet without tracing, document the result in `VERIFICATION.md` and switch the SDK transport to the EIP-2771 relayer fallback.
