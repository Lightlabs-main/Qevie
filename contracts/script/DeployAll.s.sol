// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint} from "../src/interfaces/IEntryPoint.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IQIEDexPair} from "../src/interfaces/IQIEDexPair.sol";
import {QevieSmartAccountFactory} from "../src/account/QevieSmartAccountFactory.sol";
import {QeviePaymaster} from "../src/paymaster/QeviePaymaster.sol";
import {BatchPayments} from "../src/payments/BatchPayments.sol";
import {PaymentRequest} from "../src/payments/PaymentRequest.sol";
import {SubscriptionManager} from "../src/subscriptions/SubscriptionManager.sol";
import {UsernameRegistry} from "../src/registry/UsernameRegistry.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function label(address addr, string calldata lbl) external;
}

/// @notice Deploy all qevie Phase 2-3 contracts.
/// @dev Required env vars:
///   DEPLOY_PRIVATE_KEY        deployer/owner key
///   ENTRYPOINT_ADDRESS        deployed EntryPoint v0.7
///   QUSDC_ADDRESS             QUSDC token (6 decimals)
///   WQIE_ADDRESS              wQIE token (18 decimals)
///   DEX_PAIR_ADDRESS          WQIE/QUSDC Uniswap-v2 pair
///   TRUSTED_SIGNER_ADDRESS    off-chain paymaster-service signer
///
/// After deployment, record all addresses in VERIFICATION.md and fund:
///   entryPoint.depositTo{value: ...}(address(paymaster))
contract DeployAll {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployed {
        address factory;
        address paymaster;
        address batch;
        address request;
        address subscription;
        address registry;
    }

    function run() external returns (Deployed memory deployed) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address entryPointAddr = VM.envAddress("ENTRYPOINT_ADDRESS");
        address qusdcAddr = VM.envAddress("QUSDC_ADDRESS");
        address wqieAddr = VM.envAddress("WQIE_ADDRESS");
        address dexPairAddr = VM.envAddress("DEX_PAIR_ADDRESS");
        address trustedSigner = VM.envAddress("TRUSTED_SIGNER_ADDRESS");

        VM.startBroadcast(deployerKey);

        QevieSmartAccountFactory factory = new QevieSmartAccountFactory(IEntryPoint(entryPointAddr));

        QeviePaymaster paymaster = new QeviePaymaster(
            IEntryPoint(entryPointAddr),
            IERC20(qusdcAddr),
            wqieAddr,
            IQIEDexPair(dexPairAddr),
            trustedSigner
        );

        BatchPayments batch = new BatchPayments(IERC20(qusdcAddr));
        PaymentRequest request = new PaymentRequest(IERC20(qusdcAddr));
        SubscriptionManager subscription = new SubscriptionManager(IERC20(qusdcAddr));
        UsernameRegistry registry = new UsernameRegistry();

        // Whitelist payment contracts in the paymaster for Mode B scope restriction.
        paymaster.setAllowedTarget(qusdcAddr, true);
        paymaster.setAllowedTarget(address(batch), true);
        paymaster.setAllowedTarget(address(request), true);
        paymaster.setAllowedTarget(address(subscription), true);
        paymaster.setAllowedTarget(address(registry), true);

        VM.stopBroadcast();

        deployed = Deployed({
            factory: address(factory),
            paymaster: address(paymaster),
            batch: address(batch),
            request: address(request),
            subscription: address(subscription),
            registry: address(registry)
        });
    }
}
