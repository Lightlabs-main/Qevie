// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReceiptRegistry
/// @notice Verifiable receipt registry for Qevie payment activity.
/// @dev This contract does not custody funds. It only records receipt metadata
///      from authorized Qevie issuers.
contract ReceiptRegistry {
    enum ReceiptType {
        SINGLE_PAYMENT,
        BATCH_PAYMENT,
        PAYMENT_REQUEST_SETTLED,
        SUBSCRIPTION_PAYMENT,
        MERCHANT_CHECKOUT,
        MANUAL_RECEIPT
    }

    struct Receipt {
        bytes32 receiptId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bool amountPrivate;
        bytes32 metadataHash;
        bytes32 paymentReference;
        ReceiptType receiptType;
        uint64 timestamp;
        address issuer;
    }

    mapping(bytes32 => Receipt) public receipts;
    mapping(address => bytes32[]) private _receiptsByPayer;
    mapping(address => bytes32[]) private _receiptsByPayee;
    mapping(address => bool) public authorizedIssuers;
    mapping(address => uint256) public totalReceiptsByAccount;

    uint256 public totalReceipts;
    address public owner;

    event ReceiptCreated(
        bytes32 indexed receiptId,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount,
        bool amountPrivate,
        bytes32 metadataHash,
        bytes32 paymentReference,
        ReceiptType receiptType,
        address issuer,
        uint64 timestamp
    );
    event ReceiptIssuerAuthorized(address indexed issuer, bool authorized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error UnauthorizedIssuer(address caller);
    error ZeroOwner();
    error ZeroPayer();
    error ZeroPayee();
    error ZeroToken();
    error ZeroAmount();
    error ZeroMetadataHash();
    error ReceiptAlreadyExists(bytes32 receiptId);
    error InvalidReceiptType(uint8 receiptType);

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedIssuer(msg.sender);
        _;
    }

    modifier onlyAuthorizedIssuer() {
        if (!authorizedIssuers[msg.sender]) revert UnauthorizedIssuer(msg.sender);
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    /// @notice Create a new verified receipt.
    /// @param payer Paying account.
    /// @param payee Receiving account.
    /// @param token ERC-20 token used for settlement.
    /// @param amount Token amount in smallest units.
    /// @param amountPrivate UI-level privacy flag for public display.
    /// @param metadataHash Deterministic off-chain metadata hash.
    /// @param paymentReference Linked payment transaction hash or external reference.
    /// @param receiptType Type of receipt.
    function createReceipt(
        address payer,
        address payee,
        address token,
        uint256 amount,
        bool amountPrivate,
        bytes32 metadataHash,
        bytes32 paymentReference,
        ReceiptType receiptType
    ) external onlyAuthorizedIssuer returns (bytes32 receiptId) {
        if (payer == address(0)) revert ZeroPayer();
        if (payee == address(0)) revert ZeroPayee();
        if (token == address(0)) revert ZeroToken();
        if (amount == 0) revert ZeroAmount();
        if (metadataHash == bytes32(0)) revert ZeroMetadataHash();
        if (uint8(receiptType) > uint8(ReceiptType.MANUAL_RECEIPT)) {
            revert InvalidReceiptType(uint8(receiptType));
        }

        receiptId = keccak256(
            abi.encodePacked(
                block.chainid,
                payer,
                payee,
                token,
                amount,
                metadataHash,
                paymentReference,
                receiptType,
                block.timestamp,
                msg.sender,
                totalReceipts
            )
        );
        if (receipts[receiptId].receiptId != bytes32(0)) revert ReceiptAlreadyExists(receiptId);

        Receipt memory receipt = Receipt({
            receiptId: receiptId,
            payer: payer,
            payee: payee,
            token: token,
            amount: amount,
            amountPrivate: amountPrivate,
            metadataHash: metadataHash,
            paymentReference: paymentReference,
            receiptType: receiptType,
            timestamp: uint64(block.timestamp),
            issuer: msg.sender
        });

        receipts[receiptId] = receipt;
        _receiptsByPayer[payer].push(receiptId);
        _receiptsByPayee[payee].push(receiptId);
        totalReceipts += 1;
        totalReceiptsByAccount[payer] += 1;
        totalReceiptsByAccount[payee] += 1;

        emit ReceiptCreated(
            receiptId,
            payer,
            payee,
            token,
            amount,
            amountPrivate,
            metadataHash,
            paymentReference,
            receiptType,
            msg.sender,
            uint64(block.timestamp)
        );
    }

    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getReceiptsByPayer(address payer) external view returns (bytes32[] memory) {
        return _receiptsByPayer[payer];
    }

    function getReceiptsByPayee(address payee) external view returns (bytes32[] memory) {
        return _receiptsByPayee[payee];
    }

    function setAuthorizedIssuer(address issuer, bool authorized) external onlyOwner {
        authorizedIssuers[issuer] = authorized;
        emit ReceiptIssuerAuthorized(issuer, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
