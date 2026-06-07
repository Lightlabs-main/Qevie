// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentActionType, AgentPolicy} from "./AgentTypes.sol";

interface IAgentPolicyManager {
    struct CreateAgentPolicyParams {
        address smartAccount;
        address sessionKey;
        address guardian;
        address token;
        uint256 maxPerTx;
        uint256 dailyLimit;
        uint256 weeklyLimit;
        uint256 totalLimit;
        uint256 maxQusdcGasPerTx;
        uint256 dailyQusdcGasCap;
        uint64 validAfter;
        uint64 validUntil;
        bool allowSinglePayment;
        bool allowBatchPayment;
        bool allowPaymentRequest;
        bool allowSubscription;
        bool allowSponsoredGas;
        bool allowQusdcGas;
        bool allowNativeQieFallback;
        bool pauseWhenGasUnavailable;
        address[] recipients;
    }

    function createPolicy(CreateAgentPolicyParams calldata params)
        external
        returns (bytes32 policyId);

    function revokePolicy(bytes32 policyId) external;
    function guardianRevoke(bytes32 policyId, string calldata reason) external;
    function setRecipients(bytes32 policyId, address[] calldata recipients, bool allowed) external;
    function getPoliciesBySmartAccount(address smartAccount) external view returns (bytes32[] memory);
    function getPolicy(bytes32 policyId) external view returns (AgentPolicy memory);
    function getPolicySessionKey(bytes32 policyId) external view returns (address);
    function isRecipientAllowed(bytes32 policyId, address recipient) external view returns (bool);
    function validateSessionCall(
        bytes32 policyId,
        address smartAccount,
        address sessionKey,
        address target,
        uint256 value,
        bytes calldata callData
    ) external view returns (bool allowed, bytes4 action, uint256 totalAmount, string memory reason);
    function validateSessionBatchCall(
        bytes32 policyId,
        address smartAccount,
        address sessionKey,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    ) external view returns (bool allowed, AgentActionType actionType, uint256 totalAmount, string memory reason);
    function recordSessionCall(
        bytes32 policyId,
        address target,
        uint256 value,
        bytes calldata callData
    ) external returns (AgentActionType actionType, uint256 totalAmount);
    function recordSessionBatchCall(
        bytes32 policyId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    ) external returns (AgentActionType actionType, uint256 totalAmount);
}

