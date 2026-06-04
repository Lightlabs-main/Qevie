// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal secp256k1 ECDSA helpers for qevie accounts.
library Ecdsa {
    bytes32 private constant _HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice Recover signer for a 65-byte ECDSA signature.
    function tryRecover(bytes32 digest, bytes memory signature)
        internal
        pure
        returns (address signer)
    {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        if (uint256(s) > uint256(_HALF_ORDER)) {
            return address(0);
        }

        signer = ecrecover(digest, v, r, s);
    }

    /// @notice Convert a 32-byte digest into the ERC-191 message digest signed by EOA wallets.
    function toEthSignedMessageHash(bytes32 digest) internal pure returns (bytes32) {
        bytes32 result;
        assembly {
            mstore(0x00, 0x19457468657265756d205369676e6564204d6573736167653a0a333200000000)
            mstore(0x1c, digest)
            result := keccak256(0x00, 0x3c)
        }
        return result;
    }
}
