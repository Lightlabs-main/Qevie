// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Testnet-only DEX pair stub with configurable reserves. NOT for mainnet.
/// @dev Provides the same interface as a Uniswap v2 pair so QeviePaymaster can
///      derive a QUSDC/WQIE price on testnet without a real liquidity pool.
contract TestDexPair {
    address public token0;
    address public token1;
    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;

    address public owner;

    event ReservesUpdated(uint112 reserve0, uint112 reserve1);

    error NotOwner();

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
        owner = msg.sender;
        _blockTimestampLast = uint32(block.timestamp);
    }

    /// @notice Owner can update reserves to simulate price changes.
    function setReserves(uint112 reserve0, uint112 reserve1) external {
        if (msg.sender != owner) revert NotOwner();
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = uint32(block.timestamp);
        emit ReservesUpdated(reserve0, reserve1);
    }

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
    {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }
}
