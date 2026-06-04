// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for QIE Domains on-chain registry.
/// @dev Verified registry proxy: 0x26cCB3fABd6db18834987134d715Ba2346CE7223 on QIE mainnet.
///      ABIs reverse-engineered from QIE Domains public app bundle; read-only paths only.
interface IQIEDomains {
    /// @notice Return the .qie domain string registered for a given address, or "" if none.
    function userDomain(address user) external view returns (string memory);

    /// @notice Return true if a domain name is currently registered.
    function domainExist(string calldata name) external view returns (bool);
}
