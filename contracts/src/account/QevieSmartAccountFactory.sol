// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {IAgentPolicyManager} from "../agent/IAgentPolicyManager.sol";
import {QevieSmartAccount} from "./QevieSmartAccount.sol";

/// @title QevieSmartAccountFactory
/// @notice Deterministic CREATE2 factory for qevie ERC-4337 smart accounts.
contract QevieSmartAccountFactory {
    IEntryPoint private immutable ENTRY_POINT;
    IAgentPolicyManager private immutable AGENT_POLICY_MANAGER;

    event AccountCreated(address indexed account, address indexed owner, uint256 indexed salt);

    error InvalidEntryPoint();
    error InvalidPolicyManager();
    error InvalidOwner();

    /// @param anEntryPoint The trusted ERC-4337 EntryPoint v0.7 contract used by new accounts.
    /// @param aPolicyManager The on-chain policy manager assigned to all accounts.
    constructor(IEntryPoint anEntryPoint, IAgentPolicyManager aPolicyManager) {
        if (address(anEntryPoint) == address(0)) {
            revert InvalidEntryPoint();
        }
        if (address(aPolicyManager) == address(0)) {
            revert InvalidPolicyManager();
        }
        ENTRY_POINT = anEntryPoint;
        AGENT_POLICY_MANAGER = aPolicyManager;
    }

    /// @notice Return the trusted ERC-4337 EntryPoint assigned to new accounts.
    function entryPoint() public view returns (IEntryPoint) {
        return ENTRY_POINT;
    }

    /// @notice Return the policy manager assigned to accounts created by this factory.
    function agentPolicyManager() public view returns (IAgentPolicyManager) {
        return AGENT_POLICY_MANAGER;
    }

    /// @notice Create an account for `owner` and `salt`, or return the existing account.
    function createAccount(address owner, uint256 salt)
        external
        returns (QevieSmartAccount account)
    {
        if (owner == address(0)) {
            revert InvalidOwner();
        }

        address predicted = getAddress(owner, salt);
        if (predicted.code.length != 0) {
            return QevieSmartAccount(payable(predicted));
        }

        account = new QevieSmartAccount{salt: _create2Salt(owner, salt)}(
            ENTRY_POINT, owner, address(AGENT_POLICY_MANAGER)
        );
        emit AccountCreated(address(account), owner, salt);
    }

    /// @notice Compute the counterfactual account address for an owner/salt pair.
    function getAddress(address owner, uint256 salt) public view returns (address predicted) {
        if (owner == address(0)) {
            revert InvalidOwner();
        }

        bytes memory initCode = abi.encodePacked(
            type(QevieSmartAccount).creationCode,
            abi.encode(ENTRY_POINT, owner, address(AGENT_POLICY_MANAGER))
        );
        bytes32 initCodeHash;
        assembly {
            initCodeHash := keccak256(add(initCode, 0x20), mload(initCode))
        }
        bytes32 saltBytes = _create2Salt(owner, salt);
        bytes32 digest;
        assembly {
            let ptr := mload(0x40)
            mstore8(ptr, 0xff)
            mstore(add(ptr, 0x01), shl(96, address()))
            mstore(add(ptr, 0x15), saltBytes)
            mstore(add(ptr, 0x35), initCodeHash)
            digest := keccak256(ptr, 0x55)
        }

        predicted = address(uint160(uint256(digest)));
    }

    function _create2Salt(address owner, uint256 salt) private pure returns (bytes32) {
        bytes32 saltBytes;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, owner)
            mstore(add(ptr, 0x20), salt)
            saltBytes := keccak256(ptr, 0x40)
        }
        return saltBytes;
    }
}
