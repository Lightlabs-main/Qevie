// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentPolicyManager} from "../agent/IAgentPolicyManager.sol";
import {IAccount} from "../interfaces/IAccount.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../interfaces/PackedUserOperation.sol";
import {Ecdsa} from "../utils/Ecdsa.sol";

/// @title QevieSmartAccount
/// @notice ERC-4337 v0.7 smart account with owner and scoped session-key validation paths.
contract QevieSmartAccount is IAccount {
    using Ecdsa for bytes32;

    enum SignatureMode {
        OWNER,
        SESSION_KEY
    }

    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID_VALUE = 0xffffffff;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant EXECUTE_BATCH_SELECTOR =
        bytes4(keccak256("executeBatch(address[],uint256[],bytes[])"));
    bytes4 private constant EXECUTE_SESSION_SELECTOR =
        bytes4(keccak256("executeSession(bytes32,address,uint256,bytes)"));
    bytes4 private constant EXECUTE_SESSION_BATCH_SELECTOR =
        bytes4(keccak256("executeSessionBatch(bytes32,address[],uint256[],bytes[])"));

    IEntryPoint private immutable ENTRY_POINT;
    address public owner;
    IAgentPolicyManager public agentPolicyManager;
    uint256 private _reentrancyStatus;

    event QevieAccountInitialized(address indexed entryPoint, address indexed owner);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event Executed(address indexed target, uint256 value, bytes data, bytes result);
    event AgentPolicyManagerUpdated(address indexed previousManager, address indexed newManager);
    event SessionExecution(
        bytes32 indexed policyId,
        address indexed sessionKey,
        address indexed target,
        uint256 value,
        bytes data
    );
    event SessionBatchExecution(
        bytes32 indexed policyId, address indexed sessionKey, uint256 callCount
    );

    error InvalidEntryPoint();
    error InvalidOwner();
    error InvalidTarget();
    error InvalidPolicyManager();
    error NotEntryPoint();
    error NotAuthorized();
    error ReentrantCall();
    error ArrayLengthMismatch();
    error CallFailed(uint256 index, bytes returndata);
    error MissingAccountFundsTransferFailed();
    error InvalidSignatureEnvelope();
    error InvalidSessionCall();
    error PolicyManagerNotSet();

    modifier onlyEntryPoint() {
        _onlyEntryPoint();
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        _onlyOwnerOrEntryPoint();
        _;
    }

    modifier onlyOwnerOrSelf() {
        _onlyOwnerOrSelf();
        _;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    constructor(IEntryPoint anEntryPoint, address initialOwner) payable {
        if (address(anEntryPoint) == address(0)) revert InvalidEntryPoint();
        if (initialOwner == address(0)) revert InvalidOwner();

        ENTRY_POINT = anEntryPoint;
        owner = initialOwner;
        _reentrancyStatus = _NOT_ENTERED;

        emit QevieAccountInitialized(address(anEntryPoint), initialOwner);
    }

    receive() external payable {}

    function entryPoint() public view returns (IEntryPoint) {
        return ENTRY_POINT;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override onlyEntryPoint returns (uint256 validationData) {
        validationData = _isValidUserOpSignature(userOp, userOpHash) ? 0 : SIG_VALIDATION_FAILED;
        _payPrefund(missingAccountFunds);
    }

    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwnerOrEntryPoint
        nonReentrant
        returns (bytes memory result)
    {
        result = _call(0, target, value, data);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external onlyOwnerOrEntryPoint nonReentrant returns (bytes[] memory results) {
        uint256 length = targets.length;
        if (length != values.length || length != data.length) revert ArrayLengthMismatch();

        results = new bytes[](length);
        for (uint256 index; index < length; ++index) {
            results[index] = _call(index, targets[index], values[index], data[index]);
        }
    }

    function executeSession(bytes32 policyId, address target, uint256 value, bytes calldata data)
        external
        onlyEntryPoint
        nonReentrant
        returns (bytes memory result)
    {
        if (address(agentPolicyManager) == address(0)) revert PolicyManagerNotSet();
        agentPolicyManager.recordSessionCall(policyId, target, value, data);
        address sessionKey = agentPolicyManager.getPolicySessionKey(policyId);
        result = _call(0, target, value, data);
        emit SessionExecution(policyId, sessionKey, target, value, data);
    }

    function executeSessionBatch(
        bytes32 policyId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external onlyEntryPoint nonReentrant returns (bytes[] memory results) {
        if (address(agentPolicyManager) == address(0)) revert PolicyManagerNotSet();

        uint256 length = targets.length;
        if (length != values.length || length != data.length) revert ArrayLengthMismatch();

        agentPolicyManager.recordSessionBatchCall(policyId, targets, values, data);
        address sessionKey = agentPolicyManager.getPolicySessionKey(policyId);

        results = new bytes[](length);
        for (uint256 index; index < length; ++index) {
            results[index] = _call(index, targets[index], values[index], data[index]);
        }
        emit SessionBatchExecution(policyId, sessionKey, length);
    }

    function updateOwner(address newOwner) external onlyOwnerOrSelf {
        if (newOwner == address(0)) revert InvalidOwner();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnerChanged(previousOwner, newOwner);
    }

    function setAgentPolicyManager(address manager) external onlyOwnerOrSelf {
        if (manager == address(0)) revert InvalidPolicyManager();
        address previousManager = address(agentPolicyManager);
        agentPolicyManager = IAgentPolicyManager(manager);
        emit AgentPolicyManagerUpdated(previousManager, manager);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        bytes memory signatureBytes = signature;
        address rawSigner = Ecdsa.tryRecover(hash, signatureBytes);
        address messageSigner = Ecdsa.tryRecover(hash.toEthSignedMessageHash(), signatureBytes);
        return
            rawSigner == owner || messageSigner == owner
                ? ERC1271_MAGIC_VALUE
                : ERC1271_INVALID_VALUE;
    }

    function _isValidUserOpSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        private
        view
        returns (bool)
    {
        (uint8 modeRaw, bytes memory signatureData) = abi.decode(userOp.signature, (uint8, bytes));
        SignatureMode mode = SignatureMode(modeRaw);

        if (mode == SignatureMode.OWNER) {
            return Ecdsa.tryRecover(userOpHash.toEthSignedMessageHash(), signatureData) == owner;
        }
        if (mode == SignatureMode.SESSION_KEY) {
            return _isValidSessionSignature(userOp, userOpHash, signatureData);
        }

        revert InvalidSignatureEnvelope();
    }

    function _isValidSessionSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        bytes memory signatureData
    ) private view returns (bool) {
        if (address(agentPolicyManager) == address(0)) revert PolicyManagerNotSet();

        (bytes32 policyId, address sessionKey, bytes memory sessionSignature) =
            abi.decode(signatureData, (bytes32, address, bytes));
        if (Ecdsa.tryRecover(userOpHash.toEthSignedMessageHash(), sessionSignature) != sessionKey) {
            return false;
        }
        if (userOp.callData.length < 4) revert InvalidSessionCall();

        bytes4 selector = bytes4(userOp.callData[:4]);
        if (selector == EXECUTE_SESSION_SELECTOR) {
            (bytes32 callPolicyId, address target, uint256 value, bytes memory data) =
                abi.decode(userOp.callData[4:], (bytes32, address, uint256, bytes));
            if (callPolicyId != policyId) return false;
            (bool allowed,,,) = agentPolicyManager.validateSessionCall(
                policyId, address(this), sessionKey, target, value, data
            );
            return allowed;
        }

        if (selector == EXECUTE_SESSION_BATCH_SELECTOR) {
            (
                bytes32 callPolicyId,
                address[] memory targets,
                uint256[] memory values,
                bytes[] memory data
            ) = abi.decode(userOp.callData[4:], (bytes32, address[], uint256[], bytes[]));
            if (callPolicyId != policyId) return false;
            (bool allowed,,,) = agentPolicyManager.validateSessionBatchCall(
                policyId, address(this), sessionKey, targets, values, data
            );
            return allowed;
        }

        if (selector == EXECUTE_SELECTOR || selector == EXECUTE_BATCH_SELECTOR) {
            return false;
        }

        revert InvalidSessionCall();
    }

    function _call(uint256 index, address target, uint256 value, bytes calldata data)
        private
        returns (bytes memory result)
    {
        if (target == address(0)) revert InvalidTarget();

        bool success;
        (success, result) = target.call{value: value}(data);
        if (!success) revert CallFailed(index, result);

        emit Executed(target, value, data, result);
    }

    function _payPrefund(uint256 missingAccountFunds) private {
        if (missingAccountFunds == 0) return;

        (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
        if (!success) revert MissingAccountFundsTransferFailed();
    }

    function _onlyEntryPoint() private view {
        if (msg.sender != address(ENTRY_POINT)) revert NotEntryPoint();
    }

    function _onlyOwnerOrEntryPoint() private view {
        if (msg.sender != owner && msg.sender != address(ENTRY_POINT)) revert NotAuthorized();
    }

    function _onlyOwnerOrSelf() private view {
        if (msg.sender != owner && msg.sender != address(this)) revert NotAuthorized();
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
