// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentPolicyManager} from "../src/agent/IAgentPolicyManager.sol";
import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../src/interfaces/PackedUserOperation.sol";
import {QevieSmartAccount} from "../src/account/QevieSmartAccount.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Creates one real sponsored Autopilot policy through EntryPoint on QIE testnet.
contract AutopilotPolicySmoke {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SALT = 909_001;
    uint256 private constant VERIFICATION_GAS = 3_000_000;
    uint256 private constant CALL_GAS = 800_000;
    uint256 private constant PAYMASTER_VERIFICATION_GAS = 500_000;
    uint256 private constant PAYMASTER_POSTOP_GAS = 200_000;
    uint256 private constant PRE_VERIFICATION_GAS = 150_000;
    uint256 private constant MAX_FEE = 1 gwei;

    function run() external returns (address smartAccount, bytes32 policyId) {
        uint256 ownerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        uint256 paymasterSignerKey = VM.envUint("PAYMASTER_SIGNER_PRIVATE_KEY");
        address owner = VM.addr(ownerKey);
        IEntryPoint entryPoint = IEntryPoint(VM.envAddress("ENTRYPOINT_ADDRESS"));
        QevieSmartAccountFactory factory =
            QevieSmartAccountFactory(VM.envAddress("ACCOUNT_FACTORY_ADDRESS"));
        IAgentPolicyManager manager =
            IAgentPolicyManager(VM.envAddress("AGENT_POLICY_MANAGER_ADDRESS"));
        address paymaster = VM.envAddress("PAYMASTER_ADDRESS");
        address qusdc = VM.envAddress("QUSDC_ADDRESS");

        smartAccount = factory.getAddress(owner, SALT);
        uint256 policyNonce = _policyNonce(address(manager), smartAccount);
        policyId =
            keccak256(abi.encode(block.chainid, smartAccount, VM.addr(0xA710), owner, policyNonce));

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: smartAccount,
            nonce: entryPoint.getNonce(smartAccount, 0),
            initCode: smartAccount.code.length == 0
                ? abi.encodePacked(
                    address(factory),
                    abi.encodeCall(QevieSmartAccountFactory.createAccount, (owner, SALT))
                )
                : bytes(""),
            callData: _buildCallData(manager, smartAccount, qusdc),
            accountGasLimits: _pack(VERIFICATION_GAS, CALL_GAS),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: _pack(MAX_FEE, MAX_FEE),
            paymasterAndData: _buildPaymasterAndData(paymaster, paymasterSignerKey, smartAccount),
            signature: ""
        });
        userOp.signature = _signOwnerEnvelope(ownerKey, _userOpDigest(entryPoint, userOp));

        VM.startBroadcast(ownerKey);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(owner));
        VM.stopBroadcast();

        require(smartAccount.code.length > 0, "account not deployed");
        require(
            address(QevieSmartAccount(payable(smartAccount)).agentPolicyManager())
                == address(manager),
            "policy manager mismatch"
        );
        bytes32[] memory policies = manager.getPoliciesBySmartAccount(smartAccount);
        require(policies.length > 0 && policies[policies.length - 1] == policyId, "policy missing");
    }

    function _buildCallData(IAgentPolicyManager manager, address smartAccount, address qusdc)
        private
        returns (bytes memory)
    {
        address[] memory recipients = new address[](1);
        recipients[0] = address(0xBEEF);
        IAgentPolicyManager.CreateAgentPolicyParams memory params =
            IAgentPolicyManager.CreateAgentPolicyParams({
                smartAccount: smartAccount,
                sessionKey: VM.addr(0xA710),
                guardian: VM.addr(0x6A11D),
                token: qusdc,
                maxPerTx: 10e6,
                dailyLimit: 20e6,
                weeklyLimit: 50e6,
                totalLimit: 100e6,
                maxQusdcGasPerTx: 100_000,
                dailyQusdcGasCap: 1e6,
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
        bytes memory managerCall = abi.encodeCall(manager.createPolicy, (params));
        return
            abi.encodeCall(QevieSmartAccount.execute, (address(manager), uint256(0), managerCall));
    }

    function _buildPaymasterAndData(address paymaster, uint256 signerKey, address smartAccount)
        private
        returns (bytes memory)
    {
        uint32 expiry = uint32(block.timestamp + 10 minutes);
        bytes32 digest = keccak256(abi.encode(smartAccount, expiry, block.chainid));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(signerKey, ethDigest);
        return abi.encodePacked(
            paymaster,
            uint128(PAYMASTER_VERIFICATION_GAS),
            uint128(PAYMASTER_POSTOP_GAS),
            uint8(1),
            expiry,
            r,
            s,
            v
        );
    }

    function _signOwnerEnvelope(uint256 ownerKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(ownerKey, digest);
        return abi.encode(uint8(0), abi.encodePacked(r, s, v));
    }

    function _userOpDigest(IEntryPoint entryPoint, PackedUserOperation memory userOp)
        private
        view
        returns (bytes32)
    {
        bytes32 userOpHash =
            keccak256(abi.encode(_hashUserOp(userOp), address(entryPoint), block.chainid));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
    }

    function _hashUserOp(PackedUserOperation memory op) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                op.sender,
                op.nonce,
                keccak256(op.initCode),
                keccak256(op.callData),
                op.accountGasLimits,
                op.preVerificationGas,
                op.gasFees,
                keccak256(op.paymasterAndData)
            )
        );
    }

    function _policyNonce(address manager, address smartAccount)
        private
        view
        returns (uint256 nonce)
    {
        (bool success, bytes memory result) =
            manager.staticcall(abi.encodeWithSignature("policyNonce(address)", smartAccount));
        require(success, "policy nonce read failed");
        nonce = abi.decode(result, (uint256));
    }

    function _pack(uint256 high128, uint256 low128) private pure returns (bytes32) {
        return bytes32((high128 << 128) | low128);
    }
}
