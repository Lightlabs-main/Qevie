// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title SubscriptionManager
/// @notice Manages recurring QUSDC pull-payments under payer-pre-authorized subscriptions.
///
/// A payer's smart account calls `subscribe()` to authorize a payee to pull a fixed amount of
/// QUSDC per period (e.g. weekly, monthly). The `paymaster-service` keeper submits each due
/// charge as a UserOperation on schedule. The payer can cancel at any time on-chain.
///
/// Security:
///   - Pull model: only the pre-authorized payee can trigger a charge.
///   - Enforces minimum period to prevent rapid drain.
///   - Cannot charge more than `amount` per `period` or before `nextChargeAt`.
///   - Cancelled subscriptions can never be charged again.
///   - Reentrancy guard on charge.
contract SubscriptionManager {
    IERC20 public immutable qusdc;

    /// @notice Minimum time between charges: 1 day.
    uint64 public constant MIN_PERIOD = 1 days;

    /// @notice Maximum number of active subscriptions per payer (anti-grief).
    uint256 public constant MAX_SUBS_PER_PAYER = 50;

    /// @notice Subscription record.
    struct Subscription {
        address payer;
        address payee;
        uint256 amount;
        uint64 period;
        uint256 maxPayments;
        uint256 paymentsMade;
        uint64 nextChargeAt;
        bool active;
    }

    uint256 private _nextId;
    mapping(uint256 => Subscription) private _subs;
    mapping(address => uint256) private _payerSubCount;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    event Subscribed(
        uint256 indexed subId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint64 period,
        uint256 maxPayments,
        uint64 startAt
    );
    event Charged(
        uint256 indexed subId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 paymentNumber
    );
    event Cancelled(uint256 indexed subId, address indexed by);

    error ZeroAddress();
    error ZeroAmount();
    error PeriodTooShort(uint64 period);
    error MaxPaymentsZero();
    error SubscriptionNotFound(uint256 id);
    error NotActive(uint256 id);
    error NotYetDue(uint256 id, uint64 nextChargeAt);
    error OnlyPayee(uint256 id);
    error OnlyPayer(uint256 id);
    error MaxPaymentsReached(uint256 id);
    error TransferFailed(uint256 id);
    error ReentrantCall();
    error TooManySubscriptions(address payer);

    constructor(IERC20 aQUSDC) {
        if (address(aQUSDC) == address(0)) revert ZeroAddress();
        qusdc = aQUSDC;
        _reentrancyStatus = _NOT_ENTERED;
        _nextId = 1;
    }

    /// @notice Create a new recurring subscription. Called by the payer's smart account.
    /// @param payee The beneficiary address pulled on each charge.
    /// @param amount QUSDC per charge (6-decimal units).
    /// @param period Seconds between charges (min MIN_PERIOD).
    /// @param maxPayments Total number of charges before the subscription auto-expires.
    /// @param startAt Earliest unix timestamp for the first charge (0 = now).
    /// @return subId The new subscription ID.
    function subscribe(
        address payee,
        uint256 amount,
        uint64 period,
        uint256 maxPayments,
        uint64 startAt
    ) external returns (uint256 subId) {
        if (payee == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (period < MIN_PERIOD) revert PeriodTooShort(period);
        if (maxPayments == 0) revert MaxPaymentsZero();

        address payer = msg.sender;
        if (_payerSubCount[payer] >= MAX_SUBS_PER_PAYER) revert TooManySubscriptions(payer);

        uint64 firstCharge = startAt > uint64(block.timestamp) ? startAt : uint64(block.timestamp);

        subId = _nextId++;
        _subs[subId] = Subscription({
            payer: payer,
            payee: payee,
            amount: amount,
            period: period,
            maxPayments: maxPayments,
            paymentsMade: 0,
            nextChargeAt: firstCharge,
            active: true
        });
        _payerSubCount[payer] += 1;

        emit Subscribed(subId, payer, payee, amount, period, maxPayments, firstCharge);
    }

    /// @notice Execute a due charge. Only the payee (or a keeper acting for the payee) may call.
    /// @dev Called through the payee's smart account or a trusted keeper UserOperation.
    ///      The payer's smart account must have approved this contract for at least `amount` QUSDC.
    function charge(uint256 subId) external {
        _nonReentrantBefore();

        Subscription storage sub = _getSub(subId);
        if (!sub.active) revert NotActive(subId);
        if (msg.sender != sub.payee) revert OnlyPayee(subId);
        if (block.timestamp < sub.nextChargeAt) revert NotYetDue(subId, sub.nextChargeAt);
        if (sub.paymentsMade >= sub.maxPayments) revert MaxPaymentsReached(subId);

        uint256 payment = sub.amount;
        address payer = sub.payer;
        address payee = sub.payee;

        // Effects before external call.
        sub.paymentsMade += 1;
        sub.nextChargeAt += sub.period;
        if (sub.paymentsMade >= sub.maxPayments) {
            sub.active = false;
            _payerSubCount[payer] -= 1;
        }

        bool ok = qusdc.transferFrom(payer, payee, payment);
        if (!ok) revert TransferFailed(subId);

        emit Charged(subId, payer, payee, payment, sub.paymentsMade);
        _nonReentrantAfter();
    }

    /// @notice Cancel a subscription. Only the payer can cancel.
    function cancel(uint256 subId) external {
        Subscription storage sub = _getSub(subId);
        if (!sub.active) revert NotActive(subId);
        if (msg.sender != sub.payer) revert OnlyPayer(subId);

        sub.active = false;
        _payerSubCount[sub.payer] -= 1;
        emit Cancelled(subId, msg.sender);
    }

    /// @notice Return subscription details.
    function getSubscription(uint256 subId) external view returns (Subscription memory) {
        return _getSub(subId);
    }

    /// @notice Return true if a subscription charge is currently due.
    function isDue(uint256 subId) external view returns (bool) {
        Subscription storage sub = _getSub(subId);
        return
            sub.active && block.timestamp >= sub.nextChargeAt && sub.paymentsMade < sub.maxPayments;
    }

    function _getSub(uint256 subId) private view returns (Subscription storage sub) {
        sub = _subs[subId];
        if (sub.payer == address(0)) revert SubscriptionNotFound(subId);
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
