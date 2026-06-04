// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/// @notice ERC-4337 v0.7 paymaster result modes returned to EntryPoint postOp.
enum PostOpMode {
    /// @notice User operation succeeded.
    opSucceeded,
    /// @notice User operation reverted but gas still charged.
    opReverted,
    /// @notice postOp itself reverted on the first attempt; EntryPoint retries with this mode.
    postOpReverted
}

/// @notice ERC-4337 v0.7 IPaymaster interface.
interface IPaymaster {
    /// @notice Validate that this paymaster agrees to sponsor the userOp.
    /// @param userOp The packed UserOperation.
    /// @param userOpHash The hash of the UserOperation.
    /// @param maxCost Maximum gas cost (in native gas-token wei) the paymaster might be charged.
    /// @return context Opaque data passed unchanged to postOp. Empty bytes if postOp is unneeded.
    /// @return validationData Packed (sigFail | validAfter | validUntil). 0 = valid, 1 = sig invalid.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    /// @notice Called by EntryPoint after the user operation executes (or reverts).
    /// @param mode How the user operation ended.
    /// @param context The bytes returned from validatePaymasterUserOp.
    /// @param actualGasCost Actual gas cost the paymaster must cover, in native-token wei.
    /// @param actualUserOpFeePerGas Effective gas price for the user operation.
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}
