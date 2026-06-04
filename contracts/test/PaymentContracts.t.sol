// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BatchPayments} from "../src/payments/BatchPayments.sol";
import {PaymentRequest} from "../src/payments/PaymentRequest.sol";
import {SubscriptionManager} from "../src/subscriptions/SubscriptionManager.sol";
import {UsernameRegistry} from "../src/registry/UsernameRegistry.sol";
import {MockQUSDC} from "./helpers/MockQUSDC.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract PaymentContractsTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockQUSDC internal token;
    BatchPayments internal batch;
    PaymentRequest internal requests;
    SubscriptionManager internal subs;
    UsernameRegistry internal registry;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);

    function setUp() internal {
        token = new MockQUSDC();
        batch = new BatchPayments(token);
        requests = new PaymentRequest(token);
        subs = new SubscriptionManager(token);
        registry = new UsernameRegistry();
    }

    // ---------------------------------------------------------------------------
    // BatchPayments
    // ---------------------------------------------------------------------------

    function testBatchPayDisbursesManyRecipients() external {
        setUp();
        token.mint(alice, 300e6);
        VM.prank(alice);
        token.approve(address(batch), 300e6);

        address[] memory recipients = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        recipients[0] = bob;
        recipients[1] = carol;
        recipients[2] = address(0xDEAD);
        amounts[0] = 100e6;
        amounts[1] = 100e6;
        amounts[2] = 100e6;

        VM.prank(alice);
        batch.batchPay(recipients, amounts, bytes32("test-batch"));

        require(token.balanceOf(bob) == 100e6, "bob balance wrong");
        require(token.balanceOf(carol) == 100e6, "carol balance wrong");
        require(token.balanceOf(address(0xDEAD)) == 100e6, "dead balance wrong");
        require(token.balanceOf(alice) == 0, "alice should have 0");
    }

    function testBatchPayRevertsOnArrayMismatch() external {
        setUp();
        token.mint(alice, 100e6);
        VM.prank(alice);
        token.approve(address(batch), 100e6);

        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = bob;
        recipients[1] = carol;
        amounts[0] = 50e6;

        bool reverted;
        VM.prank(alice);
        try batch.batchPay(recipients, amounts, bytes32(0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on mismatch");
    }

    function testBatchPayRevertsOnZeroRecipient() external {
        setUp();
        token.mint(alice, 100e6);
        VM.prank(alice);
        token.approve(address(batch), 100e6);

        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = address(0);
        amounts[0] = 100e6;

        bool reverted;
        VM.prank(alice);
        try batch.batchPay(recipients, amounts, bytes32(0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero recipient");
    }

    // ---------------------------------------------------------------------------
    // PaymentRequest
    // ---------------------------------------------------------------------------

    function testCreateAndPayRequest() external {
        setUp();
        VM.prank(alice);
        uint256 reqId = requests.createRequest(bob, 50e6, bytes32("lunch"), 86_400);

        token.mint(bob, 100e6);
        VM.prank(bob);
        token.approve(address(requests), 50e6);

        VM.prank(bob);
        requests.payRequest(reqId);

        require(token.balanceOf(alice) == 50e6, "alice should receive");
        require(token.balanceOf(bob) == 50e6, "bob should have paid");

        PaymentRequest.Request memory req = requests.getRequest(reqId);
        require(req.status == PaymentRequest.Status.Paid, "status should be paid");
    }

    function testCancelRequest() external {
        setUp();
        VM.prank(alice);
        uint256 reqId = requests.createRequest(bob, 50e6, bytes32(0), 86_400);

        VM.prank(alice);
        requests.cancelRequest(reqId);

        PaymentRequest.Request memory req = requests.getRequest(reqId);
        require(req.status == PaymentRequest.Status.Cancelled, "should be cancelled");
    }

    function testExpiredRequestCannotBePaid() external {
        setUp();
        VM.prank(alice);
        uint256 reqId = requests.createRequest(bob, 50e6, bytes32(0), 100);

        VM.warp(block.timestamp + 101);

        token.mint(bob, 100e6);
        VM.prank(bob);
        token.approve(address(requests), 50e6);

        bool reverted;
        VM.prank(bob);
        try requests.payRequest(reqId) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "expired request should revert");
    }

    function testWrongPayerCannotPayRequest() external {
        setUp();
        VM.prank(alice);
        uint256 reqId = requests.createRequest(bob, 50e6, bytes32(0), 86_400);

        token.mint(carol, 100e6);
        VM.prank(carol);
        token.approve(address(requests), 50e6);

        bool reverted;
        VM.prank(carol);
        try requests.payRequest(reqId) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "wrong payer should revert");
    }

    // ---------------------------------------------------------------------------
    // SubscriptionManager
    // ---------------------------------------------------------------------------

    function testSubscribeAndCharge() external {
        setUp();

        VM.prank(alice);
        uint256 subId = subs.subscribe(bob, 10e6, 1 days, 12, 0);

        // Alice pre-approves subscription manager.
        token.mint(alice, 120e6);
        VM.prank(alice);
        token.approve(address(subs), 120e6);

        VM.prank(bob);
        subs.charge(subId);

        require(token.balanceOf(bob) == 10e6, "bob should receive first charge");

        SubscriptionManager.Subscription memory sub = subs.getSubscription(subId);
        require(sub.paymentsMade == 1, "paymentsMade should be 1");
        require(sub.nextChargeAt == block.timestamp + 1 days, "nextChargeAt wrong");
    }

    function testCannotChargeBeforeDue() external {
        setUp();

        VM.prank(alice);
        uint256 subId = subs.subscribe(bob, 10e6, 1 days, 12, 0);

        token.mint(alice, 120e6);
        VM.prank(alice);
        token.approve(address(subs), 120e6);

        VM.prank(bob);
        subs.charge(subId);

        // Try to charge again immediately.
        bool reverted;
        VM.prank(bob);
        try subs.charge(subId) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "should revert: not yet due");
    }

    function testSubscriptionAutoExpires() external {
        setUp();

        VM.prank(alice);
        uint256 subId = subs.subscribe(bob, 10e6, 1 days, 2, 0);

        token.mint(alice, 50e6);
        VM.prank(alice);
        token.approve(address(subs), 50e6);

        VM.prank(bob);
        subs.charge(subId);
        VM.warp(block.timestamp + 1 days + 1);
        VM.prank(bob);
        subs.charge(subId);

        SubscriptionManager.Subscription memory sub = subs.getSubscription(subId);
        require(!sub.active, "should be inactive after maxPayments");

        bool reverted;
        VM.warp(block.timestamp + 1 days + 1);
        VM.prank(bob);
        try subs.charge(subId) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "expired sub should revert");
    }

    function testOnlyPayerCanCancel() external {
        setUp();

        VM.prank(alice);
        uint256 subId = subs.subscribe(bob, 10e6, 1 days, 12, 0);

        bool reverted;
        VM.prank(carol);
        try subs.cancel(subId) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-payer should not cancel");

        VM.prank(alice);
        subs.cancel(subId);

        require(!subs.getSubscription(subId).active, "should be cancelled");
    }

    // ---------------------------------------------------------------------------
    // UsernameRegistry
    // ---------------------------------------------------------------------------

    function testRegisterAndResolve() external {
        setUp();

        VM.prank(alice);
        registry.register("alice_qie");

        address resolved = registry.resolve("alice_qie");
        require(resolved == alice, "resolution wrong");
    }

    function testReverseResolve() external {
        setUp();

        VM.prank(alice);
        registry.register("alice_qie");

        string memory name = registry.reverseResolve(alice);
        require(
            keccak256(bytes(name)) == keccak256(bytes("alice_qie")), "reverse resolution wrong"
        );
    }

    function testCannotRegisterTakenUsername() external {
        setUp();

        VM.prank(alice);
        registry.register("taken");

        bool reverted;
        VM.prank(bob);
        try registry.register("taken") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "duplicate username should revert");
    }

    function testCannotRegisterTwoUsernamesPerAccount() external {
        setUp();

        VM.prank(alice);
        registry.register("alice1");

        bool reverted;
        VM.prank(alice);
        try registry.register("alice2") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "second username should revert");
    }

    function testReleaseAndReRegister() external {
        setUp();

        VM.prank(alice);
        registry.register("alice_qie");

        VM.prank(alice);
        registry.release();

        require(registry.resolve("alice_qie") == address(0), "should be unregistered");

        VM.prank(bob);
        registry.register("alice_qie");
        require(registry.resolve("alice_qie") == bob, "bob should own it now");
    }

    function testInvalidCharRejected() external {
        setUp();

        bool reverted;
        VM.prank(alice);
        try registry.register("UPPERCASE") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "uppercase should revert");
    }
}
