# QIE Testnet Bundler

Phase 0 confirmed `debug_traceCall` is unavailable on tested public QIE RPCs. This runbook starts Voltaire in unsafe/no-trace mode for the Phase 1 GO/NO-GO compatibility test.

This is not the final production bundler posture.

## Start

```sh
export QIE_TESTNET_RPC=https://rpc1testnet.qie.digital/
export BUNDLER_SECRET=replace-with-funded-testnet-private-key
export BUNDLER_PORT=4337

docker compose -f infra/bundler/docker-compose.yml up
```

## Test

After EntryPoint and the factory are deployed, send a minimal UserOperation that:

1. uses factory `initCode` for a counterfactual `QevieSmartAccount`
2. calls `execute(target, value, data)`
3. is signed with ERC-191 `signMessage(userOpHash)`

If Voltaire cannot reliably simulate and submit on QIE testnet without tracing, document the result in `VERIFICATION.md` and switch the SDK transport to the EIP-2771 relayer fallback.
