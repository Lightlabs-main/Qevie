// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPolicyManager} from "../src/agent/AgentPolicyManager.sol";
import {IAgentPolicyManager} from "../src/agent/IAgentPolicyManager.sol";
import {AgentPolicy} from "../src/agent/AgentTypes.sol";
import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {QevieSmartAccount} from "../src/account/QevieSmartAccount.sol";
import {MockQUSDC} from "./helpers/MockQUSDC.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract AgentPolicyManagerTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant SESSION_KEY = 0xB0B;
    uint256 private constant GUARDIAN_KEY = 0xCAFE;

    function testCreatePolicyAndValidateTransfer() external {
        address owner = VM.addr(OWNER_KEY);
        address sessionKey = VM.addr(SESSION_KEY);
        address guardian = VM.addr(GUARDIAN_KEY);
        address recipient = address(0xBEEF);

        MockQUSDC token = new MockQUSDC();
        AgentPolicyManager manager = new AgentPolicyManager();
        manager.setAllowedTarget(address(token), true);

        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(manager));

        IAgentPolicyManager.CreateAgentPolicyParams memory params =
            _policyParams(address(account), sessionKey, guardian, address(token), recipient);
        VM.prank(owner);
        bytes32 policyId = manager.createPolicy(params);

        (bool allowed,, uint256 amount,) = manager.validateSessionCall(
            policyId,
            address(account),
            sessionKey,
            address(token),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", recipient, 5e6)
        );

        require(allowed, "expected transfer to be allowed");
        require(amount == 5e6, "wrong amount");
    }

    function testGuardianRevokeBlocksValidation() external {
        address owner = VM.addr(OWNER_KEY);
        address sessionKey = VM.addr(SESSION_KEY);
        address guardian = VM.addr(GUARDIAN_KEY);
        address recipient = address(0xBEEF);

        MockQUSDC token = new MockQUSDC();
        AgentPolicyManager manager = new AgentPolicyManager();
        manager.setAllowedTarget(address(token), true);

        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(manager));

        IAgentPolicyManager.CreateAgentPolicyParams memory params =
            _policyParams(address(account), sessionKey, guardian, address(token), recipient);
        VM.prank(owner);
        bytes32 policyId = manager.createPolicy(params);

        VM.prank(guardian);
        manager.guardianRevoke(policyId, "risk");

        (bool success,) = address(manager)
            .staticcall(
                abi.encodeCall(
                    manager.validateSessionCall,
                    (
                        policyId,
                        address(account),
                        sessionKey,
                        address(token),
                        0,
                        abi.encodeWithSignature("transfer(address,uint256)", recipient, 1e6)
                    )
                )
            );
        require(!success, "validation should revert after guardian revoke");
    }

    function testRecordSessionCallUpdatesSpendAndWindowResets() external {
        address owner = VM.addr(OWNER_KEY);
        address sessionKey = VM.addr(SESSION_KEY);
        address guardian = VM.addr(GUARDIAN_KEY);
        address recipient = address(0xBEEF);

        MockQUSDC token = new MockQUSDC();
        AgentPolicyManager manager = new AgentPolicyManager();
        manager.setAllowedTarget(address(token), true);

        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(manager));

        IAgentPolicyManager.CreateAgentPolicyParams memory params =
            _policyParams(address(account), sessionKey, guardian, address(token), recipient);
        VM.prank(owner);
        bytes32 policyId = manager.createPolicy(params);

        bytes memory transferCall =
            abi.encodeWithSignature("transfer(address,uint256)", recipient, 2e6);

        VM.prank(address(account));
        manager.recordSessionCall(policyId, address(token), 0, transferCall);

        AgentPolicy memory firstPolicy = manager.getPolicy(policyId);
        require(firstPolicy.spentToday == 2e6, "spentToday wrong");
        require(firstPolicy.spentThisWeek == 2e6, "spentThisWeek wrong");
        require(firstPolicy.spentTotal == 2e6, "spentTotal wrong");

        VM.warp(block.timestamp + 1 days + 1);
        VM.prank(address(account));
        manager.recordSessionCall(policyId, address(token), 0, transferCall);

        AgentPolicy memory secondPolicy = manager.getPolicy(policyId);
        require(secondPolicy.spentToday == 2e6, "day window should reset");
        require(secondPolicy.spentThisWeek == 4e6, "week spend should accumulate");
        require(secondPolicy.spentTotal == 4e6, "total spend should accumulate");
    }

    function _policyParams(
        address smartAccount,
        address sessionKey,
        address guardian,
        address token,
        address recipient
    ) private view returns (IAgentPolicyManager.CreateAgentPolicyParams memory params) {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        params = IAgentPolicyManager.CreateAgentPolicyParams({
            smartAccount: smartAccount,
            sessionKey: sessionKey,
            guardian: guardian,
            token: token,
            maxPerTx: 10e6,
            dailyLimit: 20e6,
            weeklyLimit: 50e6,
            totalLimit: 100e6,
            maxQusdcGasPerTx: 100_000,
            dailyQusdcGasCap: 500_000,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 7 days),
            allowSinglePayment: true,
            allowBatchPayment: false,
            allowPaymentRequest: false,
            allowSubscription: false,
            allowSponsoredGas: true,
            allowQusdcGas: true,
            allowNativeQieFallback: false,
            pauseWhenGasUnavailable: true,
            recipients: recipients
        });
    }
}
