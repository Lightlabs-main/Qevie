// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

import {QevieSmartAccount} from "../src/account/QevieSmartAccount.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract SmokeCounter {
    uint256 public number;

    function increment() external {
        ++number;
    }
}

/// @notice Sends one real UserOperation through EntryPoint on QIE testnet.
/// @dev This is a Phase 1 AA-core smoke test, not a paymaster-funded payment.
contract SmokeUserOp {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ACCOUNT_SALT = 1;
    uint256 private constant VERIFICATION_GAS_LIMIT = 1_500_000;
    uint256 private constant CALL_GAS_LIMIT = 250_000;
    uint256 private constant PRE_VERIFICATION_GAS = 80_000;
    uint256 private constant USER_OP_GAS_PRICE = 1 gwei;
    uint256 private constant MIN_ACCOUNT_DEPOSIT = 0.01 ether;

    struct BuildContext {
        uint256 ownerKey;
        address owner;
        IEntryPoint entryPoint;
        QevieSmartAccountFactory factory;
        address accountAddress;
        address counterAddress;
    }

    function run()
        external
        returns (address accountAddress, address counterAddress, uint256 counterValue)
    {
        uint256 ownerKey = VM.envUint("TESTNET_PRIVATE_KEY");
        address owner = VM.addr(ownerKey);
        IEntryPoint entryPoint = IEntryPoint(VM.envAddress("ENTRYPOINT_ADDRESS"));
        QevieSmartAccountFactory factory =
            QevieSmartAccountFactory(VM.envAddress("ACCOUNT_FACTORY_ADDRESS"));

        accountAddress = factory.getAddress(owner, ACCOUNT_SALT);

        VM.startBroadcast(ownerKey);

        if (entryPoint.balanceOf(accountAddress) < MIN_ACCOUNT_DEPOSIT) {
            entryPoint.depositTo{value: MIN_ACCOUNT_DEPOSIT}(accountAddress);
        }

        SmokeCounter counter = new SmokeCounter();
        counterAddress = address(counter);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _buildUserOp(
            BuildContext({
                ownerKey: ownerKey,
                owner: owner,
                entryPoint: entryPoint,
                factory: factory,
                accountAddress: accountAddress,
                counterAddress: counterAddress
            })
        );

        entryPoint.handleOps(ops, payable(owner));

        counterValue = counter.number();
        require(counterValue == 1, "counter not incremented");

        VM.stopBroadcast();
    }

    function _buildUserOp(BuildContext memory context)
        private
        returns (PackedUserOperation memory userOp)
    {
        bytes memory initCode;
        if (context.accountAddress.code.length == 0) {
            initCode = abi.encodePacked(
                address(context.factory),
                abi.encodeCall(
                    QevieSmartAccountFactory.createAccount, (context.owner, ACCOUNT_SALT)
                )
            );
        }

        bytes memory counterCall = abi.encodeCall(SmokeCounter.increment, ());
        bytes memory accountCall =
            abi.encodeCall(QevieSmartAccount.execute, (context.counterAddress, 0, counterCall));

        userOp = PackedUserOperation({
            sender: context.accountAddress,
            nonce: context.entryPoint.getNonce(context.accountAddress, 0),
            initCode: initCode,
            callData: accountCall,
            accountGasLimits: _pack(VERIFICATION_GAS_LIMIT, CALL_GAS_LIMIT),
            preVerificationGas: PRE_VERIFICATION_GAS,
            gasFees: _pack(USER_OP_GAS_PRICE, USER_OP_GAS_PRICE),
            paymasterAndData: "",
            signature: ""
        });

        bytes32 userOpHash =
            keccak256(abi.encode(_hashUserOp(userOp), address(context.entryPoint), block.chainid));
        bytes32 digest = _toEthSignedMessageHash(userOpHash);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(context.ownerKey, digest);
        userOp.signature = abi.encodePacked(r, s, v);
    }

    function _pack(uint256 high128, uint256 low128) private pure returns (bytes32) {
        require(high128 <= type(uint128).max && low128 <= type(uint128).max, "pack overflow");
        return bytes32((high128 << 128) | low128);
    }

    function _hashUserOp(PackedUserOperation memory userOp) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )
        );
    }

    function _toEthSignedMessageHash(bytes32 digest) private pure returns (bytes32) {
        bytes32 result;
        assembly {
            mstore(0x00, 0x19457468657265756d205369676e6564204d6573736167653a0a333200000000)
            mstore(0x1c, digest)
            result := keccak256(0x00, 0x3c)
        }
        return result;
    }
}
