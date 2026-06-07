// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {IAgentPolicyManager} from "../src/agent/IAgentPolicyManager.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the Phase 1 account factory after EntryPoint v0.7 is deployed.
contract DeployFactory {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (QevieSmartAccountFactory factory) {
        uint256 deployerKey = VM.envUint("TESTNET_PRIVATE_KEY");
        address entryPoint = VM.envAddress("ENTRYPOINT_ADDRESS");
        address policyManager = VM.envAddress("AGENT_POLICY_MANAGER_ADDRESS");

        VM.startBroadcast(deployerKey);
        factory = new QevieSmartAccountFactory(
            IEntryPoint(entryPoint), IAgentPolicyManager(policyManager)
        );
        VM.stopBroadcast();
    }
}
