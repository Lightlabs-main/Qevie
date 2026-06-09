// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentPolicyManager} from "./IAgentPolicyManager.sol";
import {AgentActionType, AgentPolicy} from "./AgentTypes.sol";

interface IQevieSmartAccountOwner {
    function owner() external view returns (address);
}

interface IERC20TransferLike {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IBatchPaymentsLike {
    function batchPay(address[] calldata recipients, uint256[] calldata amounts, bytes32 batchId)
        external;
}

interface IPaymentRequestLike {
    enum Status {
        Pending,
        Paid,
        Cancelled
    }

    struct Request {
        address requestor;
        address payer;
        uint256 amount;
        bytes32 memo;
        uint64 expiry;
        Status status;
    }

    function createRequest(address payer, uint256 amount, bytes32 memo, uint64 expiryDelta)
        external
        returns (uint256);
    function payRequest(uint256 requestId) external;
    function getRequest(uint256 requestId) external view returns (Request memory);
}

interface ISubscriptionManagerLike {
    function subscribe(
        address payee,
        uint256 amount,
        uint64 period,
        uint256 maxPayments,
        uint64 startAt
    ) external returns (uint256);
}

contract AgentPolicyManager is IAgentPolicyManager {
    bytes4 private constant ERC20_TRANSFER_SELECTOR = IERC20TransferLike.transfer.selector;
    bytes4 private constant BATCH_PAY_SELECTOR = IBatchPaymentsLike.batchPay.selector;
    bytes4 private constant CREATE_REQUEST_SELECTOR = IPaymentRequestLike.createRequest.selector;
    bytes4 private constant PAY_REQUEST_SELECTOR = IPaymentRequestLike.payRequest.selector;
    bytes4 private constant SUBSCRIBE_SELECTOR = ISubscriptionManagerLike.subscribe.selector;

    address public owner;

    mapping(bytes32 => AgentPolicy) private _policies;
    mapping(address => bytes32[]) private _policiesBySmartAccount;
    mapping(bytes32 => mapping(address => bool)) private _allowedRecipients;
    mapping(address => bool) public allowedTargets;
    mapping(address => uint256) public policyNonce;

    event AgentPolicyCreated(
        bytes32 indexed policyId,
        address indexed smartAccount,
        address indexed sessionKey,
        address guardian,
        address token,
        uint64 validUntil
    );
    event AgentPolicyRevoked(bytes32 indexed policyId, address indexed smartAccount);
    event AgentPolicyGuardianRevoked(
        bytes32 indexed policyId, address indexed guardian, string reason
    );
    event AgentPolicySpendRecorded(
        bytes32 indexed policyId,
        address indexed smartAccount,
        address indexed sessionKey,
        AgentActionType actionType,
        uint256 amount
    );
    event AgentPolicyRecipientUpdated(
        bytes32 indexed policyId, address indexed recipient, bool allowed
    );
    event AgentPolicyAllowedTargetUpdated(address indexed target, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPolicyOwner();
    error NotGuardian();
    error InvalidSmartAccount();
    error InvalidSessionKey();
    error InvalidGuardian();
    error InvalidToken();
    error InvalidLimit();
    error InvalidValidity();
    error EmptyRecipients();
    error UnknownPolicy();
    error UnauthorizedCaller();
    error ZeroAddress();
    error ArrayLengthMismatch();
    error ValidationFailed(string reason);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedTargets[target] = allowed;
        emit AgentPolicyAllowedTargetUpdated(target, allowed);
    }

    function createPolicy(CreateAgentPolicyParams calldata params)
        external
        returns (bytes32 policyId)
    {
        if (params.smartAccount == address(0)) revert InvalidSmartAccount();
        if (params.sessionKey == address(0)) revert InvalidSessionKey();
        if (params.guardian == address(0)) revert InvalidGuardian();
        if (params.token == address(0)) revert InvalidToken();
        if (
            params.maxPerTx == 0 || params.dailyLimit == 0 || params.weeklyLimit == 0
                || params.totalLimit == 0
        ) revert InvalidLimit();
        if (params.validUntil <= block.timestamp || params.validUntil <= params.validAfter) {
            revert InvalidValidity();
        }
        if (params.recipients.length == 0) revert EmptyRecipients();
        if (
            !params.allowSinglePayment && !params.allowBatchPayment && !params.allowPaymentRequest
                && !params.allowSubscription
        ) revert InvalidLimit();
        if (
            !params.allowSponsoredGas && !params.allowQusdcGas && !params.allowNativeQieFallback
                && !params.pauseWhenGasUnavailable
        ) revert InvalidLimit();

        address accountOwner = IQevieSmartAccountOwner(params.smartAccount).owner();
        if (msg.sender != accountOwner && msg.sender != params.smartAccount) {
            revert NotPolicyOwner();
        }

        uint256 nonce = policyNonce[params.smartAccount]++;
        policyId = keccak256(
            abi.encode(block.chainid, params.smartAccount, params.sessionKey, accountOwner, nonce)
        );

        AgentPolicy storage policy = _policies[policyId];
        policy.smartAccount = params.smartAccount;
        policy.owner = accountOwner;
        policy.sessionKey = params.sessionKey;
        policy.guardian = params.guardian;
        policy.token = params.token;
        policy.maxPerTx = params.maxPerTx;
        policy.dailyLimit = params.dailyLimit;
        policy.weeklyLimit = params.weeklyLimit;
        policy.totalLimit = params.totalLimit;
        policy.maxQusdcGasPerTx = params.maxQusdcGasPerTx;
        policy.dailyQusdcGasCap = params.dailyQusdcGasCap;
        policy.dayWindowStart = uint64(block.timestamp);
        policy.weekWindowStart = uint64(block.timestamp);
        policy.gasDayWindowStart = uint64(block.timestamp);
        policy.validAfter = params.validAfter;
        policy.validUntil = params.validUntil;
        policy.allowSinglePayment = params.allowSinglePayment;
        policy.allowBatchPayment = params.allowBatchPayment;
        policy.allowPaymentRequest = params.allowPaymentRequest;
        policy.allowSubscription = params.allowSubscription;
        policy.allowSponsoredGas = params.allowSponsoredGas;
        policy.allowQusdcGas = params.allowQusdcGas;
        policy.allowNativeQieFallback = params.allowNativeQieFallback;
        policy.pauseWhenGasUnavailable = params.pauseWhenGasUnavailable;
        policy.active = true;

        for (uint256 i; i < params.recipients.length; ++i) {
            address recipient = params.recipients[i];
            if (recipient == address(0)) revert ZeroAddress();
            _allowedRecipients[policyId][recipient] = true;
            emit AgentPolicyRecipientUpdated(policyId, recipient, true);
        }

        _policiesBySmartAccount[params.smartAccount].push(policyId);
        emit AgentPolicyCreated(
            policyId,
            params.smartAccount,
            params.sessionKey,
            params.guardian,
            params.token,
            params.validUntil
        );
    }

    function revokePolicy(bytes32 policyId) external {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        if (msg.sender != policy.owner && msg.sender != policy.smartAccount) {
            revert NotPolicyOwner();
        }
        policy.active = false;
        emit AgentPolicyRevoked(policyId, policy.smartAccount);
    }

    function guardianRevoke(bytes32 policyId, string calldata reason) external {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        if (msg.sender != policy.guardian) revert NotGuardian();
        policy.guardianRevoked = true;
        policy.active = false;
        emit AgentPolicyGuardianRevoked(policyId, msg.sender, reason);
    }

    function setRecipients(bytes32 policyId, address[] calldata recipients, bool allowed) external {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        if (msg.sender != policy.owner && msg.sender != policy.smartAccount) {
            revert NotPolicyOwner();
        }
        if (recipients.length == 0) revert EmptyRecipients();
        for (uint256 i; i < recipients.length; ++i) {
            address recipient = recipients[i];
            if (recipient == address(0)) revert ZeroAddress();
            _allowedRecipients[policyId][recipient] = allowed;
            emit AgentPolicyRecipientUpdated(policyId, recipient, allowed);
        }
    }

    function getPoliciesBySmartAccount(address smartAccount)
        external
        view
        returns (bytes32[] memory)
    {
        return _policiesBySmartAccount[smartAccount];
    }

    function getPolicy(bytes32 policyId) external view returns (AgentPolicy memory) {
        return _getPolicyStorage(policyId);
    }

    function getPolicySessionKey(bytes32 policyId) external view returns (address) {
        return _getPolicyStorage(policyId).sessionKey;
    }

    function isRecipientAllowed(bytes32 policyId, address recipient) external view returns (bool) {
        return _allowedRecipients[policyId][recipient];
    }

    function validateSessionCall(
        bytes32 policyId,
        address smartAccount,
        address sessionKey,
        address target,
        uint256 value,
        bytes calldata callData
    )
        external
        view
        returns (bool allowed, bytes4 action, uint256 totalAmount, string memory reason)
    {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        _basePolicyChecks(policy, smartAccount, sessionKey);
        return _validateSingleChecked(policyId, policy, target, value, callData);
    }

    function validateSessionBatchCall(
        bytes32 policyId,
        address smartAccount,
        address sessionKey,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    )
        external
        view
        returns (
            bool allowed,
            AgentActionType actionType,
            uint256 totalAmount,
            string memory reason
        )
    {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        _basePolicyChecks(policy, smartAccount, sessionKey);
        return _validateBatchChecked(policyId, policy, targets, values, callData);
    }

    function recordSessionCall(
        bytes32 policyId,
        address target,
        uint256 value,
        bytes calldata callData
    ) external returns (AgentActionType actionType, uint256 totalAmount) {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        if (msg.sender != policy.smartAccount) revert UnauthorizedCaller();
        (bool allowed,, uint256 amount, string memory reason) =
            _validateBoundSingle(policyId, policy, target, value, callData);
        if (!allowed) revert ValidationFailed(reason);
        _refreshWindows(policy);
        policy.spentToday += amount;
        policy.spentThisWeek += amount;
        policy.spentTotal += amount;
        actionType = _actionTypeForCall(callData);
        totalAmount = amount;
        emit AgentPolicySpendRecorded(
            policyId, policy.smartAccount, policy.sessionKey, actionType, totalAmount
        );
    }

    function recordSessionBatchCall(
        bytes32 policyId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    ) external returns (AgentActionType actionType, uint256 totalAmount) {
        AgentPolicy storage policy = _getPolicyStorage(policyId);
        if (msg.sender != policy.smartAccount) revert UnauthorizedCaller();
        (bool allowed, AgentActionType batchAction, uint256 amount, string memory reason) =
            _validateBoundBatch(policyId, policy, targets, values, callData);
        if (!allowed) revert ValidationFailed(reason);
        _refreshWindows(policy);
        policy.spentToday += amount;
        policy.spentThisWeek += amount;
        policy.spentTotal += amount;
        actionType = batchAction;
        totalAmount = amount;
        emit AgentPolicySpendRecorded(
            policyId, policy.smartAccount, policy.sessionKey, actionType, totalAmount
        );
    }

    function _validateBatchChecked(
        bytes32 policyId,
        AgentPolicy storage policy,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    )
        private
        view
        returns (
            bool allowed,
            AgentActionType actionType,
            uint256 totalAmount,
            string memory reason
        )
    {
        if (targets.length == 0) {
            return (false, AgentActionType.BATCH_PAYMENT, 0, "empty batch");
        }
        if (targets.length != values.length || targets.length != callData.length) {
            return (false, AgentActionType.BATCH_PAYMENT, 0, "array length mismatch");
        }

        actionType = AgentActionType.BATCH_PAYMENT;
        for (uint256 i; i < targets.length; ++i) {
            (bool ok, bytes4 selector, uint256 amount, string memory why) =
                _validateSingleChecked(policyId, policy, targets[i], values[i], callData[i]);
            if (!ok) return (false, actionType, 0, why);
            if (_actionTypeForSelector(selector) == AgentActionType.SUBSCRIPTION) {
                actionType = AgentActionType.SUBSCRIPTION;
            } else if (_actionTypeForSelector(selector) == AgentActionType.PAYMENT_REQUEST) {
                actionType = AgentActionType.PAYMENT_REQUEST;
            }
            totalAmount += amount;
        }

        (uint256 effectiveToday, uint256 effectiveWeek) = _effectiveWindowSpend(policy);
        if (totalAmount > policy.maxPerTx && targets.length == 1) {
            return (false, actionType, totalAmount, "amount exceeds max per tx");
        }
        if (effectiveToday + totalAmount > policy.dailyLimit) {
            return (false, actionType, totalAmount, "daily cap exceeded");
        }
        if (effectiveWeek + totalAmount > policy.weeklyLimit) {
            return (false, actionType, totalAmount, "weekly cap exceeded");
        }
        if (policy.spentTotal + totalAmount > policy.totalLimit) {
            return (false, actionType, totalAmount, "total cap exceeded");
        }
        return (true, actionType, totalAmount, "");
    }

    function _validateBoundSingle(
        bytes32 policyId,
        AgentPolicy storage policy,
        address target,
        uint256 value,
        bytes calldata callData
    )
        private
        view
        returns (bool allowed, bytes4 action, uint256 totalAmount, string memory reason)
    {
        return _validateSingleChecked(policyId, policy, target, value, callData);
    }

    function _validateBoundBatch(
        bytes32 policyId,
        AgentPolicy storage policy,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata callData
    )
        private
        view
        returns (
            bool allowed,
            AgentActionType actionType,
            uint256 totalAmount,
            string memory reason
        )
    {
        return _validateBatchChecked(policyId, policy, targets, values, callData);
    }

    function _validateSingleChecked(
        bytes32 policyId,
        AgentPolicy storage policy,
        address target,
        uint256 value,
        bytes calldata callData
    )
        private
        view
        returns (bool allowed, bytes4 action, uint256 totalAmount, string memory reason)
    {
        if (value != 0) {
            return (false, bytes4(0), 0, "native value not allowed");
        }
        if (!allowedTargets[target]) return (false, bytes4(0), 0, "unsupported target");
        if (callData.length < 4) return (false, bytes4(0), 0, "unsupported selector");

        bytes4 selector = bytes4(callData[:4]);
        action = selector;

        if (target == policy.token && selector == ERC20_TRANSFER_SELECTOR) {
            if (!policy.allowSinglePayment) return (false, selector, 0, "single payment disabled");
            (address recipient, uint256 amount) = abi.decode(callData[4:], (address, uint256));
            return _validateSpend(
                policyId, policy, AgentActionType.SINGLE_PAYMENT, recipient, amount, selector
            );
        }

        if (selector == BATCH_PAY_SELECTOR) {
            if (!policy.allowBatchPayment) return (false, selector, 0, "batch payment disabled");
            (address[] memory recipients, uint256[] memory amounts,) =
                abi.decode(callData[4:], (address[], uint256[], bytes32));
            if (recipients.length == 0 || recipients.length != amounts.length) {
                return (false, selector, 0, "invalid batch");
            }
            uint256 batchAmount;
            for (uint256 i; i < recipients.length; ++i) {
                if (!_allowedRecipientsForPolicy(policyId, recipients[i])) {
                    return (false, selector, 0, "recipient not allowlisted");
                }
                if (amounts[i] == 0) return (false, selector, 0, "amount is zero");
                batchAmount += amounts[i];
            }
            return
                _validateAggregateSpend(
                    policy, AgentActionType.BATCH_PAYMENT, batchAmount, selector
                );
        }

        if (selector == CREATE_REQUEST_SELECTOR) {
            if (!policy.allowPaymentRequest) {
                return (false, selector, 0, "payment request disabled");
            }
            (address payer, uint256 amount,,) =
                abi.decode(callData[4:], (address, uint256, bytes32, uint64));
            if (payer != address(0) && payer != policy.smartAccount) {
                return (false, selector, 0, "wrong payer");
            }
            return
                _validateAggregateSpend(policy, AgentActionType.PAYMENT_REQUEST, amount, selector);
        }

        if (selector == PAY_REQUEST_SELECTOR) {
            if (!policy.allowPaymentRequest) {
                return (false, selector, 0, "payment request disabled");
            }
            (uint256 requestId) = abi.decode(callData[4:], (uint256));
            IPaymentRequestLike.Request memory req =
                IPaymentRequestLike(target).getRequest(requestId);
            if (req.payer != address(0) && req.payer != policy.smartAccount) {
                return (false, selector, 0, "wrong payer");
            }
            return _validateSpend(
                policyId,
                policy,
                AgentActionType.PAYMENT_REQUEST,
                req.requestor,
                req.amount,
                selector
            );
        }

        if (selector == SUBSCRIBE_SELECTOR) {
            if (!policy.allowSubscription) return (false, selector, 0, "subscription disabled");
            (address payee, uint256 amount,, uint256 maxPayments,) =
                abi.decode(callData[4:], (address, uint256, uint64, uint256, uint64));
            if (maxPayments == 0) return (false, selector, 0, "invalid max payments");
            if (!_allowedRecipientsForPolicy(policyId, payee)) {
                return (false, selector, 0, "recipient not allowlisted");
            }
            uint256 totalExposure = amount * maxPayments;
            return
                _validateAggregateSpend(
                    policy, AgentActionType.SUBSCRIPTION, totalExposure, selector
                );
        }

        return (false, selector, 0, "unsupported selector");
    }

    function _validateSpend(
        bytes32 policyId,
        AgentPolicy storage policy,
        AgentActionType actionType,
        address recipient,
        uint256 amount,
        bytes4 selector
    )
        private
        view
        returns (bool allowed, bytes4 action, uint256 totalAmount, string memory reason)
    {
        if (!_allowedRecipientsForPolicy(policyId, recipient)) {
            return (false, selector, 0, "recipient not allowlisted");
        }
        return _validateAggregateSpend(policy, actionType, amount, selector);
    }

    function _validateAggregateSpend(
        AgentPolicy storage policy,
        AgentActionType actionType,
        uint256 totalAmount,
        bytes4 selector
    ) private view returns (bool allowed, bytes4 action, uint256 amount, string memory reason) {
        if (totalAmount == 0) return (false, selector, 0, "amount is zero");
        if (actionType != AgentActionType.BATCH_PAYMENT && totalAmount > policy.maxPerTx) {
            return (false, selector, totalAmount, "amount exceeds max per tx");
        }
        (uint256 effectiveToday, uint256 effectiveWeek) = _effectiveWindowSpend(policy);
        if (effectiveToday + totalAmount > policy.dailyLimit) {
            return (false, selector, totalAmount, "daily cap exceeded");
        }
        if (effectiveWeek + totalAmount > policy.weeklyLimit) {
            return (false, selector, totalAmount, "weekly cap exceeded");
        }
        if (policy.spentTotal + totalAmount > policy.totalLimit) {
            return (false, selector, totalAmount, "total cap exceeded");
        }
        return (true, selector, totalAmount, "");
    }

    function _basePolicyChecks(AgentPolicy storage policy, address smartAccount, address sessionKey)
        private
        view
    {
        if (policy.smartAccount == address(0)) revert UnknownPolicy();
        if (!policy.active) revert ValidationFailed("inactive policy");
        if (policy.guardianRevoked) revert ValidationFailed("guardian revoked");
        if (block.timestamp < policy.validAfter) revert ValidationFailed("policy not active yet");
        if (block.timestamp > policy.validUntil) revert ValidationFailed("policy expired");
        if (policy.smartAccount != smartAccount) revert ValidationFailed("wrong smart account");
        if (policy.sessionKey != sessionKey) revert ValidationFailed("wrong session key");
    }

    function _refreshWindows(AgentPolicy storage policy) private {
        if (block.timestamp >= uint256(policy.dayWindowStart) + 1 days) {
            policy.dayWindowStart = uint64(block.timestamp);
            policy.spentToday = 0;
            policy.spentQusdcGasToday = 0;
        }
        if (block.timestamp >= uint256(policy.weekWindowStart) + 7 days) {
            policy.weekWindowStart = uint64(block.timestamp);
            policy.spentThisWeek = 0;
        }
        if (block.timestamp >= uint256(policy.gasDayWindowStart) + 1 days) {
            policy.gasDayWindowStart = uint64(block.timestamp);
            policy.spentQusdcGasToday = 0;
        }
    }

    function _effectiveWindowSpend(AgentPolicy storage policy)
        private
        view
        returns (uint256 effectiveToday, uint256 effectiveWeek)
    {
        effectiveToday =
            block.timestamp >= uint256(policy.dayWindowStart) + 1 days ? 0 : policy.spentToday;
        effectiveWeek =
            block.timestamp >= uint256(policy.weekWindowStart) + 7 days ? 0 : policy.spentThisWeek;
    }

    function _allowedRecipientsForPolicy(bytes32 policyId, address recipient)
        private
        view
        returns (bool)
    {
        return _allowedRecipients[policyId][recipient];
    }

    function _actionTypeForCall(bytes calldata callData) private pure returns (AgentActionType) {
        bytes4 selector = bytes4(callData[:4]);
        return _actionTypeForSelector(selector);
    }

    function _actionTypeForSelector(bytes4 selector) private pure returns (AgentActionType) {
        if (selector == BATCH_PAY_SELECTOR) return AgentActionType.BATCH_PAYMENT;
        if (selector == CREATE_REQUEST_SELECTOR || selector == PAY_REQUEST_SELECTOR) {
            return AgentActionType.PAYMENT_REQUEST;
        }
        if (selector == SUBSCRIBE_SELECTOR) return AgentActionType.SUBSCRIPTION;
        return AgentActionType.SINGLE_PAYMENT;
    }

    function _getPolicyStorage(bytes32 policyId) private view returns (AgentPolicy storage policy) {
        policy = _policies[policyId];
        if (policy.smartAccount == address(0)) revert UnknownPolicy();
    }
}
