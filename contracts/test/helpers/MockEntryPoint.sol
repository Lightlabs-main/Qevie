// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../../src/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../../src/interfaces/PackedUserOperation.sol";

/// @notice Minimal EntryPoint stub for unit tests only. Not a mock of production behaviour.
contract MockEntryPoint is IEntryPoint {
    mapping(address => uint256) public deposits;

    function handleOps(PackedUserOperation[] calldata, address payable beneficiary) external {
        (bool ok,) = beneficiary.call{value: 0}("");
        require(ok, "beneficiary call failed");
    }

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        deposits[msg.sender] -= withdrawAmount;
        (bool ok,) = withdrawAddress.call{value: withdrawAmount}("");
        require(ok, "withdraw failed");
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function getNonce(address, uint192) external pure returns (uint256) {
        return 0;
    }

    receive() external payable {}
}
