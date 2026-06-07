// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {IAgentPolicyManager} from "../src/agent/IAgentPolicyManager.sol";
import {PackedUserOperation} from "../src/interfaces/PackedUserOperation.sol";
import {QevieSmartAccount} from "../src/account/QevieSmartAccount.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
}

contract Counter {
    uint256 public number;

    function increment() external {
        ++number;
    }
}

contract QevieSmartAccountTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant OTHER_KEY = 0xB0B;

    function testFactoryReturnsCounterfactualAddress() external {
        address owner = VM.addr(OWNER_KEY);
        QevieSmartAccountFactory factory = new QevieSmartAccountFactory(
            IEntryPoint(address(this)), IAgentPolicyManager(address(1))
        );

        address predicted = factory.getAddress(owner, 7);
        QevieSmartAccount account = factory.createAccount(owner, 7);
        QevieSmartAccount accountAgain = factory.createAccount(owner, 7);

        require(address(account) == predicted, "unexpected account address");
        require(address(accountAgain) == predicted, "factory did not return existing account");
        require(account.owner() == owner, "owner not set");
        require(address(account.entryPoint()) == address(this), "entrypoint not set");
    }

    function testValidateUserOpAcceptsOwnerSignature() external {
        address owner = VM.addr(OWNER_KEY);
        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(1));

        bytes32 userOpHash = keccak256("qevie user op");
        PackedUserOperation memory userOp;
        userOp.sender = address(account);
        userOp.signature = _signOwnerUserOp(OWNER_KEY, userOpHash);

        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        require(validationData == 0, "owner signature rejected");
    }

    function testValidateUserOpFlagsBadSignatureWithoutReverting() external {
        address owner = VM.addr(OWNER_KEY);
        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(1));

        bytes32 userOpHash = keccak256("qevie bad user op");
        PackedUserOperation memory userOp;
        userOp.sender = address(account);
        userOp.signature = _signOwnerUserOp(OTHER_KEY, userOpHash);

        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        require(validationData == 1, "bad signature was not flagged");
    }

    function testEntryPointCanExecuteCall() external {
        address owner = VM.addr(OWNER_KEY);
        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(1));
        Counter counter = new Counter();

        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));

        require(counter.number() == 1, "call did not execute");
    }

    function testBatchExecuteIsAtomic() external {
        address owner = VM.addr(OWNER_KEY);
        QevieSmartAccount account =
            new QevieSmartAccount(IEntryPoint(address(this)), owner, address(1));
        Counter first = new Counter();
        Counter second = new Counter();

        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory calls = new bytes[](2);

        targets[0] = address(first);
        targets[1] = address(second);
        calls[0] = abi.encodeCall(Counter.increment, ());
        calls[1] = abi.encodeCall(Counter.increment, ());

        account.executeBatch(targets, values, calls);

        require(first.number() == 1, "first call did not execute");
        require(second.number() == 1, "second call did not execute");
    }

    function _signOwnerUserOp(uint256 privateKey, bytes32 userOpHash)
        private
        returns (bytes memory signature)
    {
        bytes32 digest = _toEthSignedMessageHash(userOpHash);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        signature = abi.encode(uint8(0), abi.encodePacked(r, s, v));
    }

    function _toEthSignedMessageHash(bytes32 digest) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
    }
}
