// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentPolicyManager} from "../src/agent/AgentPolicyManager.sol";
import {IAgentPolicyManager} from "../src/agent/IAgentPolicyManager.sol";
import {AgentPolicy} from "../src/agent/AgentTypes.sol";
import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../src/interfaces/PackedUserOperation.sol";
import {QevieSmartAccount} from "../src/account/QevieSmartAccount.sol";
import {MockQUSDC} from "./helpers/MockQUSDC.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
}

contract QevieSmartAccountSessionKeyTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant SESSION_KEY = 0xB0B;
    uint256 private constant GUARDIAN_KEY = 0xCAFE;

    function testSessionKeyUserOpValidatesAndExecutes() external {
        (
            QevieSmartAccount account,
            AgentPolicyManager manager,
            MockQUSDC token,
            bytes32 policyId,
            address recipient
        ) = _setUpPolicy();

        token.mint(address(account), 10e6);

        PackedUserOperation memory userOp;
        bytes32 userOpHash = keccak256("session-op");
        userOp.callData = abi.encodeCall(
            account.executeSession,
            (
                policyId,
                address(token),
                0,
                abi.encodeWithSignature("transfer(address,uint256)", recipient, 5e6)
            )
        );
        userOp.signature = _signSessionEnvelope(policyId, userOpHash);

        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        require(validationData == 0, "session signature rejected");

        account.executeSession(
            policyId,
            address(token),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", recipient, 5e6)
        );

        require(token.balanceOf(recipient) == 5e6, "recipient not paid");

        AgentPolicy memory policy = manager.getPolicy(policyId);
        require(policy.spentTotal == 5e6, "spend not recorded");
    }

    function testSessionKeyRejectsPolicyMismatchAndGenericExecute() external {
        (QevieSmartAccount account,, MockQUSDC token, bytes32 policyId, address recipient) =
            _setUpPolicy();

        PackedUserOperation memory mismatchOp;
        bytes32 mismatchHash = keccak256("mismatch");
        mismatchOp.callData = abi.encodeCall(
            account.executeSession,
            (
                bytes32(uint256(policyId) + 1),
                address(token),
                0,
                abi.encodeWithSignature("transfer(address,uint256)", recipient, 1e6)
            )
        );
        mismatchOp.signature = _signSessionEnvelope(policyId, mismatchHash);
        require(
            account.validateUserOp(mismatchOp, mismatchHash, 0) == 1, "policy mismatch accepted"
        );

        PackedUserOperation memory genericOp;
        bytes32 genericHash = keccak256("generic");
        genericOp.callData = abi.encodeCall(
            account.execute,
            (
                address(token),
                0,
                abi.encodeWithSignature("transfer(address,uint256)", recipient, 1e6)
            )
        );
        genericOp.signature = _signSessionEnvelope(policyId, genericHash);
        require(account.validateUserOp(genericOp, genericHash, 0) == 1, "generic execute accepted");
    }

    function _setUpPolicy()
        private
        returns (
            QevieSmartAccount account,
            AgentPolicyManager manager,
            MockQUSDC token,
            bytes32 policyId,
            address recipient
        )
    {
        address owner = VM.addr(OWNER_KEY);
        address sessionKey = VM.addr(SESSION_KEY);
        address guardian = VM.addr(GUARDIAN_KEY);
        recipient = address(0xBEEF);

        token = new MockQUSDC();
        manager = new AgentPolicyManager();
        manager.setAllowedTarget(address(token), true);

        account = new QevieSmartAccount(IEntryPoint(address(this)), owner, address(manager));

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        IAgentPolicyManager.CreateAgentPolicyParams memory params =
            IAgentPolicyManager.CreateAgentPolicyParams({
                smartAccount: address(account),
                sessionKey: sessionKey,
                guardian: guardian,
                token: address(token),
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

        VM.prank(owner);
        policyId = manager.createPolicy(params);
    }

    function _signSessionEnvelope(bytes32 policyId, bytes32 userOpHash)
        private
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(SESSION_KEY, digest);
        bytes memory rawSig = abi.encodePacked(r, s, v);
        return abi.encode(uint8(1), abi.encode(policyId, VM.addr(SESSION_KEY), rawSig));
    }
}
