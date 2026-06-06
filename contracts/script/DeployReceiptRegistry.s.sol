// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiptRegistry} from "../src/receipts/ReceiptRegistry.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function addr(uint256 privateKey) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy the Qevie ReceiptRegistry and authorize the configured
///         off-chain issuer in one transaction batch.
/// @dev Required env vars:
///   DEPLOY_PRIVATE_KEY        deployer/owner key
///   TRUSTED_SIGNER_ADDRESS    off-chain receipt issuer / paymaster signer
contract DeployReceiptRegistry {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployed {
        address owner;
        address issuer;
        address receiptRegistry;
    }

    function run() external returns (Deployed memory deployed) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address owner = VM.addr(deployerKey);
        address issuer = VM.envAddress("TRUSTED_SIGNER_ADDRESS");

        VM.startBroadcast(deployerKey);

        ReceiptRegistry registry = new ReceiptRegistry(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.stopBroadcast();

        deployed = Deployed({owner: owner, issuer: issuer, receiptRegistry: address(registry)});
    }
}
