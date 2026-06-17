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

If Voltaire cannot reliably simulate and submit on QIE testnet without tracing, document the result in the root `README.md` and switch the SDK transport to the EIP-2771 relayer fallback.

## Mainnet: paymaster reputation / staking

`--unsafe` only skips `debug_traceCall` opcode/storage checks; it does **not**
disable the ERC-4337 reputation/stake throttle. Voltaire rejects ops with
`-32505 "paymaster <addr> is unstaked"` once an **unstaked** entity has
`>= ~10` ops in the local mempool
(`MempoolManager.validate_staked_entity_can_include_more_user_operations`,
gated by `get_max_allowed_user_operations_for_unstaked_non_senders`). In a
single-operator, `--disable_p2p` deployment this fires whenever bundling stalls
(e.g. QIE RPC slowness) and ops back up.

`QeviePaymaster` has no `addStake` passthrough, so it cannot self-stake in the
EntryPoint (`addStake` is keyed to `msg.sender`); a proper fix requires adding
`addStake`/`unlockStake`/`withdrawStake` to the paymaster and redeploying.

As the interim production fix, the trusted Qevie entities are **whitelisted** in
Voltaire's reputation manager so the stake throttle short-circuits
(`ReputationManager.is_whitelisted`). On the host this is a patch to the vendored
package — re-apply after any reinstall/upgrade:

```py
# voltaire_bundler/mempool/reputation_manager.py
class ReputationManager:
    white_list: list = [
        "0xd41c837e0c91024b41a2f456df4100d0c964bbb1",  # QeviePaymaster (lowercase)
        "0x77d6229316e3efefd22c2fa267464db7665446a6",  # QevieAccountFactory (lowercase)
    ]

    def get_status(self, entity: str) -> ReputationStatus:
        entity_address = entity.lower()
        if entity_address in self.white_list:        # <-- qevie patch
            return ReputationStatus.OK               # never throttle/ban our own entities
        if entity_address not in self.entities_reputation:
            return ReputationStatus.OK
        ...  # unchanged
```

Then `pm2 restart qevie-bundler`. Addresses must be lowercase (the check
compares `entity.lower()`). The private mempool makes this safe: the reputation
system exists to protect a shared mempool from DoS, which a single-operator
bundler does not have.

**Both patches are required.** The `white_list` field alone only short-circuits
the *stake* check (`-32505` unstaked); the ban/throttle path
(`_verify_banned_and_throttled_entities` → `get_status`) does NOT consult the
whitelist, so after a few failed ops the paymaster gets banned with `-32504
"banned paymaster"`. Patching `get_status` to return `OK` for whitelisted
entities covers both paths and clears an existing ban immediately.

If the bundler crash-loops on `Bind failed … Address already in use` for port
4337 after a restart, an orphaned python child still holds the socket. Recover
with: `pm2 stop qevie-bundler && pkill -9 -f voltaire_bundler && fuser -k
4337/tcp` (wait until `ss -ltnp | grep :4337` is empty) `&& pm2 start
qevie-bundler`.
