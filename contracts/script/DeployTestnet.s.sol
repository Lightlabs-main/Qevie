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
import {TestQUSDC} from "../src/testnet/TestQUSDC.sol";
import {TestDexPair} from "../src/testnet/TestDexPair.sol";

interface Vm {
    function envUint(string calldata key) external view returns (uint256);
    function envAddress(string calldata key) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy all qevie contracts on QIE testnet (1983), including
///         testnet-only QUSDC stub and DEX pair stub.
/// @dev Required env vars:
///   DEPLOY_PRIVATE_KEY        deployer/owner key
///   ENTRYPOINT_ADDRESS        already-deployed EntryPoint v0.7
///   TRUSTED_SIGNER_ADDRESS    paymaster-service signing address
///
/// Mirrors mainnet reserves: ~50k WQIE / ~9k QUSDC ≈ $0.185/QIE
contract DeployTestnet {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Mirror mainnet WQIE/QUSDC reserves for realistic price simulation.
    uint112 private constant INIT_WQIE_RESERVE = 50_000 ether;
    uint112 private constant INIT_QUSDC_RESERVE = 9_000e6;

    struct Deployed {
        address testQUSDC;
        address testWQIE;
        address testDexPair;
        address factory;
        address paymaster;
        address batch;
        address request;
        address subscription;
        address registry;
    }

    function run() external returns (Deployed memory d) {
        uint256 deployerKey = VM.envUint("DEPLOY_PRIVATE_KEY");
        address entryPointAddr = VM.envAddress("ENTRYPOINT_ADDRESS");
        address trustedSigner = VM.envAddress("TRUSTED_SIGNER_ADDRESS");

        VM.startBroadcast(deployerKey);

        // 1. Deploy testnet token stubs.
        TestQUSDC qusdc = new TestQUSDC();
        TestQUSDC wqie = new TestQUSDC(); // same contract, 18-dec semantics via amounts

        // 2. Deploy testnet DEX pair stub with WQIE as token0.
        TestDexPair pair = new TestDexPair(address(wqie), address(qusdc));
        pair.setReserves(INIT_WQIE_RESERVE, INIT_QUSDC_RESERVE);

        // 3. Deploy smart account factory.
        QevieSmartAccountFactory factory =
            new QevieSmartAccountFactory(IEntryPoint(entryPointAddr));

        // 4. Deploy paymaster.
        QeviePaymaster paymaster = new QeviePaymaster(
            IEntryPoint(entryPointAddr),
            IERC20(address(qusdc)),
            address(wqie),
            IQIEDexPair(address(pair)),
            trustedSigner
        );

        // 5. Deploy payment contracts.
        BatchPayments batch = new BatchPayments(IERC20(address(qusdc)));
        PaymentRequest request = new PaymentRequest(IERC20(address(qusdc)));
        SubscriptionManager subscription = new SubscriptionManager(IERC20(address(qusdc)));
        UsernameRegistry registry = new UsernameRegistry();

        // 6. Whitelist targets for Mode B sponsorship scope restriction.
        paymaster.setAllowedTarget(address(qusdc), true);
        paymaster.setAllowedTarget(address(batch), true);
        paymaster.setAllowedTarget(address(request), true);
        paymaster.setAllowedTarget(address(subscription), true);
        paymaster.setAllowedTarget(address(registry), true);

        VM.stopBroadcast();

        d = Deployed({
            testQUSDC: address(qusdc),
            testWQIE: address(wqie),
            testDexPair: address(pair),
            factory: address(factory),
            paymaster: address(paymaster),
            batch: address(batch),
            request: address(request),
            subscription: address(subscription),
            registry: address(registry)
        });
    }
}
