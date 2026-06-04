// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/// @notice Minimal ERC-4337 account interface for EntryPoint v0.7.
interface IAccount {
    /// @notice Validate a UserOperation and return packed validation data.
    /// @param userOp Full packed user operation supplied by the EntryPoint.
    /// @param userOpHash EntryPoint-computed hash over the UserOperation, EntryPoint, and chain ID.
    /// @param missingAccountFunds Native value the account must prefund when no paymaster covers gas.
    /// @return validationData 0 for valid signature, 1 for signature failure, or packed validity data.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}
