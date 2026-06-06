// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title BatchPayments
/// @notice Disburse QUSDC to many recipients atomically in a single smart-account call.
/// @dev Called through the user's QevieSmartAccount execute path. The caller must have
///      approved this contract to spend the total required QUSDC before calling.
///      Reentrancy guard protects against malicious ERC-20 callbacks.
contract BatchPayments {
    IERC20 public immutable qusdc;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    uint256 public constant MAX_RECIPIENTS = 200;

    event BatchPaid(
        address indexed sender, address[] recipients, uint256[] amounts, bytes32 indexed batchId
    );

    error ArrayLengthMismatch();
    error TooManyRecipients(uint256 count);
    error ZeroAmount(uint256 index);
    error ZeroRecipient(uint256 index);
    error TransferFailed(uint256 index);
    error ReentrantCall();
    error ZeroAddress();

    constructor(IERC20 aQUSDC) {
        if (address(aQUSDC) == address(0)) revert ZeroAddress();
        qusdc = aQUSDC;
        _reentrancyStatus = _NOT_ENTERED;
    }

    /// @notice Send QUSDC from msg.sender to many recipients atomically.
    /// @param recipients Destination addresses. Must match amounts length.
    /// @param amounts QUSDC amounts in 6-decimal units. Each must be > 0.
    /// @param batchId Off-chain identifier for this batch (for event indexing).
    function batchPay(address[] calldata recipients, uint256[] calldata amounts, bytes32 batchId)
        external
    {
        _nonReentrantBefore();

        uint256 len = recipients.length;
        if (len != amounts.length) revert ArrayLengthMismatch();
        if (len > MAX_RECIPIENTS) revert TooManyRecipients(len);

        address sender = msg.sender;
        for (uint256 i; i < len; ++i) {
            if (recipients[i] == address(0)) revert ZeroRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            bool ok = qusdc.transferFrom(sender, recipients[i], amounts[i]);
            if (!ok) revert TransferFailed(i);
        }

        emit BatchPaid(sender, recipients, amounts, batchId);
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
