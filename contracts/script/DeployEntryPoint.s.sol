// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Verifies that a previously deployed EntryPoint v0.7 is reachable.
/// @dev EntryPoint is already deployed on QIE testnet and mainnet — see VERIFICATION.md.
///      This script is kept for documentation; re-run only if deploying to a new chain.
contract DeployEntryPoint {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external view returns (address entryPointAddr, uint256 balance) {
        entryPointAddr = VM.envAddress("ENTRYPOINT_ADDRESS");
        IEntryPoint ep = IEntryPoint(entryPointAddr);
        balance = ep.balanceOf(entryPointAddr);
        require(entryPointAddr.code.length > 0, "EntryPoint not deployed at address");
    }
}
