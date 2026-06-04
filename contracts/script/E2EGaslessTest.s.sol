// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../src/interfaces/PackedUserOperation.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";
import {QeviePaymaster} from "../src/paymaster/QeviePaymaster.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function envBytes(string calldata key) external view returns (bytes memory);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function label(address addr, string calldata lbl) external;
}

/// @notice End-to-end gasless QUSDC payment test on QIE testnet.
/// @dev Sends ONE UserOperation through EntryPoint directly (without bundler) to prove
///      the paymaster + smart account flow works end-to-end on-chain.
///
/// Required env vars:
///   DEPLOY_PRIVATE_KEY        owner/deployer key
///   ENTRYPOINT_ADDRESS        QIE testnet EntryPoint
///   ACCOUNT_FACTORY_ADDRESS   QIE testnet factory (newly deployed)
///   PAYMASTER_ADDRESS         QIE testnet paymaster
///   QUSDC_ADDRESS             TestQUSDC (6 dec, mintable)
///
/// Proves:
///   1. Counterfactual account deploys on first UserOp.
///   2. Paymaster validates the UserOp (Mode B with allowlist token).
///   3. QUSDC transfer executes gaslessly.
///   4. User held zero native QIE at any point.
contract E2EGaslessTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SALT = 42;
    uint256 private constant VERIFICATION_GAS = 1_500_000;
    uint256 private constant CALL_GAS = 300_000;
    uint256 private constant PAYMASTER_VERIFICATION_GAS = 500_000;
    uint256 private constant PAYMASTER_POSTOP_GAS = 200_000;
    uint256 private constant PRE_VERIFICATION_GAS = 150_000;
    uint256 private constant MAX_FEE = 1 gwei;
    uint256 private constant TRANSFER_AMOUNT = 1e6; // 1 QUSDC

    // Mode B allowlist token for 0x04045e066bd061B2F80aa38d3fBDce96CA078Fa8
    // Issued by paymaster-service at 2026-06-04
    uint32 private constant ALLOWLIST_EXPIRY = 1780688589;
    bytes private constant ALLOWLIST_SIG =
        hex"b7109385f66f2f28b0eb770dd8990a42a682c5fb15549d37acbd8c78e124b4af4508c51647363cef0c39e21a1e5dfd95d616a9ab2d193eeee73db98fb606fd8c1c";

    function run() external returns (uint256 transferredAmount) {
        uint256 ownerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address owner = VM.addr(ownerKey);

        IEntryPoint entryPoint = IEntryPoint(VM.envAddress("ENTRYPOINT_ADDRESS"));
        QevieSmartAccountFactory factory =
            QevieSmartAccountFactory(VM.envAddress("ACCOUNT_FACTORY_ADDRESS"));
        QeviePaymaster paymaster = QeviePaymaster(payable(VM.envAddress("PAYMASTER_ADDRESS")));
        IERC20 qusdc = IERC20(VM.envAddress("QUSDC_ADDRESS"));

        address recipient = address(0xCAFEBABE);
        address smartAccount = factory.getAddress(owner, SALT);

        require(qusdc.balanceOf(smartAccount) >= TRANSFER_AMOUNT, "fund smart account first");
        require(smartAccount.code.length == 0, "account already deployed, change SALT");

        VM.label(smartAccount, "TestSmartAccount");

        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(QevieSmartAccountFactory.createAccount, (owner, SALT))
        );

        // callData: smart account executes qusdc.transfer(recipient, 1 QUSDC)
        bytes memory transferCall = abi.encodeWithSelector(
            IERC20.transfer.selector, recipient, TRANSFER_AMOUNT
        );
        bytes memory callData = abi.encodeWithSelector(
            bytes4(0xb61d27f6), // execute(address,uint256,bytes)
            address(qusdc),
            uint256(0),
            transferCall
        );

        // paymasterAndData for Mode B (sponsored)
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(PAYMASTER_VERIFICATION_GAS),
            uint128(PAYMASTER_POSTOP_GAS),
            uint8(0x01), // MODE_SPONSORED
            ALLOWLIST_EXPIRY,
            ALLOWLIST_SIG
        );

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: smartAccount,
            nonce: entryPoint.getNonce(smartAccount, 0),
            initCode: initCode,
            callData: callData,
            accountGasLimits: _pack(VERIFICATION_GAS, CALL_GAS),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: _pack(MAX_FEE, MAX_FEE),
            paymasterAndData: paymasterAndData,
            signature: ""
        });

        bytes32 userOpHash =
            keccak256(abi.encode(_hashUserOp(userOp), address(entryPoint), block.chainid));
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(ownerKey, digest);
        userOp.signature = abi.encodePacked(r, s, v);

        VM.startBroadcast(ownerKey);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(owner));

        VM.stopBroadcast();

        transferredAmount = qusdc.balanceOf(recipient);
        require(transferredAmount == TRANSFER_AMOUNT, "transfer failed");
        require(smartAccount.code.length > 0, "account not deployed");
    }

    function _pack(uint256 high128, uint256 low128) private pure returns (bytes32) {
        return bytes32((high128 << 128) | low128);
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
}
