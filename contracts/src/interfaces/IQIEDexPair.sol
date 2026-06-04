// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Uniswap-v2-style pair interface for the QIEDex WQIE/QUSDC pool.
/// @dev Verified pool: 0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe on QIE mainnet.
interface IQIEDexPair {
    /// @notice Return the two sorted token addresses for this pair.
    function token0() external view returns (address);
    function token1() external view returns (address);

    /// @notice Return current pool reserves and the last update timestamp.
    /// @return reserve0 Reserve of token0 (18-decimal WQIE is token0).
    /// @return reserve1 Reserve of token1 (6-decimal QUSDC is token1).
    /// @return blockTimestampLast Unix timestamp of the last on-chain interaction.
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}
