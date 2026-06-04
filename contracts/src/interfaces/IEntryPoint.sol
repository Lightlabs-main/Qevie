// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/// @notice Minimal EntryPoint v0.7 interface needed by qevie Phase 1 contracts.
interface IEntryPoint {
    /// @notice Execute a batch of UserOperations and pay collected fees to the beneficiary.
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;

    /// @notice Add native gas-token deposit for an account, paymaster, or factory.
    function depositTo(address account) external payable;

    /// @notice Withdraw deposited native gas token.
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

    /// @notice Return EntryPoint deposit balance for an account, paymaster, or factory.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Return the EntryPoint-managed nonce for a sender/key pair.
    function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
}
