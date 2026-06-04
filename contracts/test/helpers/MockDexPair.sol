// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IQIEDexPair} from "../../src/interfaces/IQIEDexPair.sol";

/// @notice Configurable DEX pair stub for unit tests only.
contract MockDexPair is IQIEDexPair {
    address public override token0;
    address public override token1;
    uint112 public r0;
    uint112 public r1;
    uint32 public ts;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
        ts = uint32(block.timestamp);
    }

    function setReserves(uint112 _r0, uint112 _r1) external {
        r0 = _r0;
        r1 = _r1;
        ts = uint32(block.timestamp);
    }

    function setTimestamp(uint32 _ts) external {
        ts = _ts;
    }

    function getReserves() external view override returns (uint112, uint112, uint32) {
        return (r0, r1, ts);
    }
}
