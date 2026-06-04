// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys audited eth-infinitism EntryPoint v0.7.0 from contracts/lib.
contract DeployEntryPoint {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (EntryPoint entryPoint) {
        uint256 deployerKey = VM.envUint("TESTNET_PRIVATE_KEY");

        VM.startBroadcast(deployerKey);
        entryPoint = new EntryPoint();
        VM.stopBroadcast();
    }
}
