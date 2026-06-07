// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPolicyManager} from "../src/agent/AgentPolicyManager.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function addr(uint256 privateKey) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy AgentPolicyManager and configure the supported Qevie payment targets.
/// @dev Required env vars:
///   DEPLOY_PRIVATE_KEY
///   QUSDC_ADDRESS
///   BATCH_PAYMENTS_ADDRESS
///   PAYMENT_REQUEST_ADDRESS
///   SUBSCRIPTION_MANAGER_ADDRESS
contract DeployAgentPolicyManager {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployed {
        address owner;
        address agentPolicyManager;
    }

    function run() external returns (Deployed memory deployed) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address owner = VM.addr(deployerKey);
        address qusdc = VM.envAddress("QUSDC_ADDRESS");
        address batchPayments = VM.envAddress("BATCH_PAYMENTS_ADDRESS");
        address paymentRequest = VM.envAddress("PAYMENT_REQUEST_ADDRESS");
        address subscriptionManager = VM.envAddress("SUBSCRIPTION_MANAGER_ADDRESS");

        VM.startBroadcast(deployerKey);

        AgentPolicyManager manager = new AgentPolicyManager();
        manager.setAllowedTarget(qusdc, true);
        manager.setAllowedTarget(batchPayments, true);
        manager.setAllowedTarget(paymentRequest, true);
        manager.setAllowedTarget(subscriptionManager, true);

        VM.stopBroadcast();

        deployed = Deployed({owner: owner, agentPolicyManager: address(manager)});
    }
}
