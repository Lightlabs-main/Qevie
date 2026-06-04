// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccount} from "../interfaces/IAccount.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../interfaces/PackedUserOperation.sol";
import {Ecdsa} from "../utils/Ecdsa.sol";

/// @title QevieSmartAccount
/// @notice Minimal ERC-4337 v0.7 smart account controlled by one EOA owner.
/// @dev Phase 1 account for QIE testnet validation. Paymaster policy lives in later contracts.
contract QevieSmartAccount is IAccount {
    using Ecdsa for bytes32;

    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID_VALUE = 0xffffffff;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    IEntryPoint private immutable ENTRY_POINT;
    address public owner;
    uint256 private _reentrancyStatus;

    event QevieAccountInitialized(address indexed entryPoint, address indexed owner);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event Executed(address indexed target, uint256 value, bytes data, bytes result);

    error InvalidEntryPoint();
    error InvalidOwner();
    error InvalidTarget();
    error NotEntryPoint();
    error NotAuthorized();
    error ReentrantCall();
    error ArrayLengthMismatch();
    error CallFailed(uint256 index, bytes returndata);
    error MissingAccountFundsTransferFailed();

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

    /// @param anEntryPoint The trusted ERC-4337 EntryPoint v0.7 contract.
    /// @param initialOwner The EOA that authorizes account UserOperations.
    constructor(IEntryPoint anEntryPoint, address initialOwner) payable {
        if (address(anEntryPoint) == address(0)) {
            revert InvalidEntryPoint();
        }
        if (initialOwner == address(0)) {
            revert InvalidOwner();
        }

        ENTRY_POINT = anEntryPoint;
        owner = initialOwner;
        _reentrancyStatus = _NOT_ENTERED;

        emit QevieAccountInitialized(address(anEntryPoint), initialOwner);
    }

    receive() external payable {}

    /// @notice Return the trusted ERC-4337 EntryPoint.
    function entryPoint() public view returns (IEntryPoint) {
        return ENTRY_POINT;
    }

    /// @inheritdoc IAccount
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override onlyEntryPoint returns (uint256 validationData) {
        validationData =
            _isValidUserOpSignature(userOpHash, userOp.signature) ? 0 : SIG_VALIDATION_FAILED;

        _payPrefund(missingAccountFunds);
    }

    /// @notice Execute one call from this account.
    /// @dev Callable directly by owner or indirectly by EntryPoint through account callData.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwnerOrEntryPoint
        nonReentrant
        returns (bytes memory result)
    {
        result = _call(0, target, value, data);
    }

    /// @notice Execute many calls atomically from this account.
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external onlyOwnerOrEntryPoint nonReentrant returns (bytes[] memory results) {
        uint256 length = targets.length;
        if (length != values.length || length != data.length) {
            revert ArrayLengthMismatch();
        }

        results = new bytes[](length);
        for (uint256 index; index < length; ++index) {
            results[index] = _call(index, targets[index], values[index], data[index]);
        }
    }

    /// @notice Rotate the EOA owner.
    /// @dev For gasless rotation, call this account through `execute(address(this), 0, data)`.
    function updateOwner(address newOwner) external onlyOwnerOrSelf {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }

        address previousOwner = owner;
        owner = newOwner;
        emit OwnerChanged(previousOwner, newOwner);
    }

    /// @notice ERC-1271 signature validation for integrations that check account signatures.
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        bytes memory signatureBytes = signature;
        address rawSigner = Ecdsa.tryRecover(hash, signatureBytes);
        address messageSigner = Ecdsa.tryRecover(hash.toEthSignedMessageHash(), signatureBytes);
        return
            rawSigner == owner || messageSigner == owner
                ? ERC1271_MAGIC_VALUE
                : ERC1271_INVALID_VALUE;
    }

    function _isValidUserOpSignature(bytes32 userOpHash, bytes calldata signature)
        private
        view
        returns (bool)
    {
        return Ecdsa.tryRecover(userOpHash.toEthSignedMessageHash(), signature) == owner;
    }

    function _call(uint256 index, address target, uint256 value, bytes calldata data)
        private
        returns (bytes memory result)
    {
        if (target == address(0)) {
            revert InvalidTarget();
        }

        bool success;
        (success, result) = target.call{value: value}(data);
        if (!success) {
            revert CallFailed(index, result);
        }

        emit Executed(target, value, data, result);
    }

    function _payPrefund(uint256 missingAccountFunds) private {
        if (missingAccountFunds == 0) {
            return;
        }

        (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
        if (!success) {
            revert MissingAccountFundsTransferFailed();
        }
    }

    function _onlyEntryPoint() private view {
        if (msg.sender != address(ENTRY_POINT)) {
            revert NotEntryPoint();
        }
    }

    function _onlyOwnerOrEntryPoint() private view {
        if (msg.sender != owner && msg.sender != address(ENTRY_POINT)) {
            revert NotAuthorized();
        }
    }

    function _onlyOwnerOrSelf() private view {
        if (msg.sender != owner && msg.sender != address(this)) {
            revert NotAuthorized();
        }
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) {
            revert ReentrantCall();
        }
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
