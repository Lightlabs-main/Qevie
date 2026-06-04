// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title PaymentRequest
/// @notice On-chain registry for QUSDC payment requests between smart accounts.
///         Requestors create on-chain records; payers settle them; the chain is the source of truth.
contract PaymentRequest {
    IERC20 public immutable qusdc;

    /// @notice Request status lifecycle.
    enum Status {
        Pending,
        Paid,
        Cancelled
    }

    /// @notice A stored payment request.
    struct Request {
        address requestor;
        address payer;
        uint256 amount;
        bytes32 memo;
        uint64 expiry;
        Status status;
    }

    uint256 private _nextId;
    mapping(uint256 => Request) private _requests;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    /// @notice Maximum number of seconds a request can remain open (90 days).
    uint64 public constant MAX_EXPIRY = 90 days;

    event RequestCreated(
        uint256 indexed requestId,
        address indexed requestor,
        address indexed payer,
        uint256 amount,
        bytes32 memo,
        uint64 expiry
    );
    event RequestPaid(uint256 indexed requestId, address indexed payer, uint256 amount);
    event RequestCancelled(uint256 indexed requestId, address indexed by);

    error ZeroAddress();
    error ZeroAmount();
    error ExpiryTooLong(uint64 expiry);
    error RequestNotFound(uint256 id);
    error NotPending(uint256 id, Status status);
    error NotRequestorOrPayer(uint256 id);
    error WrongPayer(uint256 id, address expected);
    error Expired(uint256 id);
    error TransferFailed(uint256 id);
    error ReentrantCall();

    constructor(IERC20 aQUSDC) {
        if (address(aQUSDC) == address(0)) revert ZeroAddress();
        qusdc = aQUSDC;
        _reentrancyStatus = _NOT_ENTERED;
        _nextId = 1;
    }

    /// @notice Create a new payment request.
    /// @param payer The smart account expected to pay. If address(0), any address may pay.
    /// @param amount QUSDC amount in 6-decimal units.
    /// @param memo Arbitrary 32-byte label (store as UTF-8 left-padded off-chain).
    /// @param expiryDelta Seconds from now until the request expires (max MAX_EXPIRY).
    /// @return requestId The new request's ID.
    function createRequest(
        address payer,
        uint256 amount,
        bytes32 memo,
        uint64 expiryDelta
    ) external returns (uint256 requestId) {
        if (amount == 0) revert ZeroAmount();
        if (expiryDelta > MAX_EXPIRY) revert ExpiryTooLong(uint64(block.timestamp) + expiryDelta);

        requestId = _nextId++;
        uint64 expiry = uint64(block.timestamp) + expiryDelta;

        _requests[requestId] = Request({
            requestor: msg.sender,
            payer: payer,
            amount: amount,
            memo: memo,
            expiry: expiry,
            status: Status.Pending
        });

        emit RequestCreated(requestId, msg.sender, payer, amount, memo, expiry);
    }

    /// @notice Pay a pending request.
    /// @dev Caller must have approved this contract for the request amount.
    function payRequest(uint256 requestId) external {
        _nonReentrantBefore();

        Request storage req = _getRequest(requestId);
        _requirePending(requestId, req);
        if (req.expiry > 0 && block.timestamp > req.expiry) revert Expired(requestId);
        if (req.payer != address(0) && req.payer != msg.sender) {
            revert WrongPayer(requestId, req.payer);
        }

        req.status = Status.Paid;

        bool ok = qusdc.transferFrom(msg.sender, req.requestor, req.amount);
        if (!ok) revert TransferFailed(requestId);

        emit RequestPaid(requestId, msg.sender, req.amount);
        _nonReentrantAfter();
    }

    /// @notice Cancel a pending request. Only the requestor or designated payer may cancel.
    function cancelRequest(uint256 requestId) external {
        Request storage req = _getRequest(requestId);
        _requirePending(requestId, req);
        if (msg.sender != req.requestor && msg.sender != req.payer) {
            revert NotRequestorOrPayer(requestId);
        }

        req.status = Status.Cancelled;
        emit RequestCancelled(requestId, msg.sender);
    }

    /// @notice Return the full details of a request.
    function getRequest(uint256 requestId) external view returns (Request memory) {
        return _getRequest(requestId);
    }

    function _getRequest(uint256 requestId) private view returns (Request storage req) {
        req = _requests[requestId];
        if (req.requestor == address(0)) revert RequestNotFound(requestId);
    }

    function _requirePending(uint256 requestId, Request storage req) private view {
        if (req.status != Status.Pending) revert NotPending(requestId, req.status);
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
