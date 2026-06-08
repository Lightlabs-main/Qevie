// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EntryPoint} from "../lib/account-abstraction/contracts/core/EntryPoint.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy a fresh eth-infinitism EntryPoint v0.7 to QIE mainnet (1990)
///         via nonce-based CREATE, mirroring the testnet deployment. The
///         canonical CREATE2 address is empty on QIE and the deterministic
///         deployer is absent, so a fresh address is expected and recorded.
contract DeployEntryPointMainnet {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address entryPointAddr) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        VM.startBroadcast(deployerKey);
        entryPointAddr = address(new EntryPoint());
        VM.stopBroadcast();
    }
}
