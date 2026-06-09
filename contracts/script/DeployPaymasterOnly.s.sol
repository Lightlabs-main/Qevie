// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IQIEDexPair} from "../src/interfaces/IQIEDexPair.sol";
import {QeviePaymaster} from "../src/paymaster/QeviePaymaster.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy ONLY a fresh QeviePaymaster reusing the already-deployed
///         testnet EntryPoint / QUSDC / WQIE / DEX pair, then re-whitelist the
///         existing qevie call targets so Mode B sponsorship keeps working.
///
/// @dev A fresh paymaster address also resets bundler reputation, clearing the
///      "banned paymaster" state that the previous (immutable) paymaster fell
///      into after returning validationData=1 on cap/budget failures.
///
/// Required env vars (all already present in /opt/qevie/.env):
///   DEPLOY_PRIVATE_KEY
///   ENTRYPOINT_ADDRESS
///   QUSDC_ADDRESS
///   WQIE_ADDRESS
///   DEX_PAIR_ADDRESS
///   TRUSTED_SIGNER_ADDRESS
///   BATCH_PAYMENTS_ADDRESS
///   PAYMENT_REQUEST_ADDRESS
///   SUBSCRIPTION_MANAGER_ADDRESS
///   USERNAME_REGISTRY_ADDRESS
///   AGENT_POLICY_MANAGER_ADDRESS
contract DeployPaymasterOnly {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address paymasterAddr) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address entryPointAddr = VM.envAddress("ENTRYPOINT_ADDRESS");
        address qusdc = VM.envAddress("QUSDC_ADDRESS");
        address wqie = VM.envAddress("WQIE_ADDRESS");
        address dexPair = VM.envAddress("DEX_PAIR_ADDRESS");
        address trustedSigner = VM.envAddress("TRUSTED_SIGNER_ADDRESS");

        VM.startBroadcast(deployerKey);

        QeviePaymaster paymaster = new QeviePaymaster(
            IEntryPoint(entryPointAddr), IERC20(qusdc), wqie, IQIEDexPair(dexPair), trustedSigner
        );

        // Re-whitelist the same targets the previous paymaster allowed.
        paymaster.setAllowedTarget(qusdc, true);
        paymaster.setAllowedTarget(VM.envAddress("BATCH_PAYMENTS_ADDRESS"), true);
        paymaster.setAllowedTarget(VM.envAddress("PAYMENT_REQUEST_ADDRESS"), true);
        paymaster.setAllowedTarget(VM.envAddress("SUBSCRIPTION_MANAGER_ADDRESS"), true);
        paymaster.setAllowedTarget(VM.envAddress("USERNAME_REGISTRY_ADDRESS"), true);
        paymaster.setAllowedTarget(VM.envAddress("AGENT_POLICY_MANAGER_ADDRESS"), true);

        VM.stopBroadcast();

        paymasterAddr = address(paymaster);
    }
}
