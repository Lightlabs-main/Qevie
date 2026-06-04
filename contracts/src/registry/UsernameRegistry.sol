// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UsernameRegistry
/// @notice On-chain fallback username → smart-account registry for qevie.
///         Used when QIE Web3 Domains on-chain resolution is unavailable.
///         Unique usernames are enforced on-chain. Each address may hold one username.
contract UsernameRegistry {
    /// @notice Maximum username length in bytes.
    uint256 public constant MAX_USERNAME_LENGTH = 32;
    /// @notice Minimum username length in bytes.
    uint256 public constant MIN_USERNAME_LENGTH = 2;

    /// @dev username hash → smart account address.
    mapping(bytes32 => address) private _usernameToAccount;
    /// @dev smart account address → raw username bytes (for reverse resolution).
    mapping(address => bytes) private _accountToUsername;

    event UsernameRegistered(bytes32 indexed usernameHash, string username, address indexed account);
    event UsernameReleased(bytes32 indexed usernameHash, address indexed account);

    error UsernameTooShort(uint256 length);
    error UsernameTooLong(uint256 length);
    error InvalidUsernameChar();
    error UsernameTaken(bytes32 usernameHash);
    error AccountAlreadyHasUsername(address account);
    error NotRegistered(address account);

    /// @notice Register a username for msg.sender.
    ///         One username per account; one account per username.
    ///         Allowed chars: lowercase a-z, 0-9, underscore.
    function register(string calldata username) external {
        bytes memory raw = bytes(username);
        uint256 len = raw.length;
        if (len < MIN_USERNAME_LENGTH) revert UsernameTooShort(len);
        if (len > MAX_USERNAME_LENGTH) revert UsernameTooLong(len);

        _validateChars(raw);

        bytes32 hash = keccak256(raw);
        if (_usernameToAccount[hash] != address(0)) revert UsernameTaken(hash);
        if (_accountToUsername[msg.sender].length != 0) {
            revert AccountAlreadyHasUsername(msg.sender);
        }

        _usernameToAccount[hash] = msg.sender;
        _accountToUsername[msg.sender] = raw;

        emit UsernameRegistered(hash, username, msg.sender);
    }

    /// @notice Release the caller's username, freeing it for re-registration.
    function release() external {
        bytes memory stored = _accountToUsername[msg.sender];
        if (stored.length == 0) revert NotRegistered(msg.sender);

        bytes32 hash = keccak256(stored);
        delete _usernameToAccount[hash];
        delete _accountToUsername[msg.sender];

        emit UsernameReleased(hash, msg.sender);
    }

    /// @notice Resolve a username to its registered smart account address.
    function resolve(string calldata username) external view returns (address account) {
        bytes32 hash = keccak256(bytes(username));
        account = _usernameToAccount[hash];
    }

    /// @notice Return the username registered for a given account, or "" if none.
    function reverseResolve(address account) external view returns (string memory) {
        bytes memory stored = _accountToUsername[account];
        return string(stored);
    }

    /// @dev Validate that every byte is lowercase a-z, 0-9, or underscore.
    function _validateChars(bytes memory raw) private pure {
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool valid = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!valid) revert InvalidUsernameChar();
        }
    }
}
