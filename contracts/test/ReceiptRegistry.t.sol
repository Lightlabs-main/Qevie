// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiptRegistry} from "../src/receipts/ReceiptRegistry.sol";

interface Vm {
    function prank(address sender) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);

    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
}

contract ReceiptRegistryTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    ReceiptRegistry internal registry;

    address internal owner = address(0xABCD);
    address internal issuer = address(0xBEEF);
    address internal payer = address(0xA11CE);
    address internal payee = address(0xB0B);
    address internal token = address(0xC0FFEE);

    function setUp() internal {
        registry = new ReceiptRegistry(owner);
    }

    function testOwnerCanAuthorizeIssuer() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);
        require(registry.authorizedIssuers(issuer), "issuer should be authorized");
    }

    function testNonOwnerCannotAuthorizeIssuer() external {
        setUp();
        bool reverted;
        VM.prank(issuer);
        try registry.setAuthorizedIssuer(issuer, true) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner should not authorize issuer");
    }

    function testAuthorizedIssuerCanCreateReceipt() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.prank(issuer);
        bytes32 receiptId = registry.createReceipt(
            payer,
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );

        ReceiptRegistry.Receipt memory receipt = registry.getReceipt(receiptId);
        require(receipt.receiptId == receiptId, "receipt id mismatch");
        require(receipt.payer == payer, "payer mismatch");
        require(receipt.payee == payee, "payee mismatch");
        require(receipt.token == token, "token mismatch");
        require(receipt.amount == 25e6, "amount mismatch");
        require(!receipt.amountPrivate, "privacy mismatch");
        require(receipt.metadataHash == bytes32("meta"), "metadata mismatch");
        require(receipt.paymentReference == bytes32("tx"), "payment reference mismatch");
        require(receipt.issuer == issuer, "issuer mismatch");
    }

    function testUnauthorizedIssuerCannotCreateReceipt() external {
        setUp();
        bool reverted;
        VM.prank(issuer);
        try registry.createReceipt(
            payer,
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "unauthorized issuer should revert");
    }

    function testAmountPrivateReceiptWorks() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.prank(issuer);
        bytes32 receiptId = registry.createReceipt(
            payer,
            payee,
            token,
            1e6,
            true,
            keccak256("private-meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.MERCHANT_CHECKOUT
        );

        ReceiptRegistry.Receipt memory receipt = registry.getReceipt(receiptId);
        require(receipt.amountPrivate, "amountPrivate should be true");
        require(receipt.amount == 1e6, "amount should still be stored");
    }

    function testGetReceiptsByPayerWorks() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.prank(issuer);
        bytes32 first = registry.createReceipt(
            payer,
            payee,
            token,
            10e6,
            false,
            bytes32("m1"),
            bytes32("tx1"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );
        VM.prank(issuer);
        bytes32 second = registry.createReceipt(
            payer,
            address(0xCAFE),
            token,
            20e6,
            false,
            bytes32("m2"),
            bytes32("tx2"),
            ReceiptRegistry.ReceiptType.BATCH_PAYMENT
        );

        bytes32[] memory ids = registry.getReceiptsByPayer(payer);
        require(ids.length == 2, "payer history length mismatch");
        require(ids[0] == first, "first receipt mismatch");
        require(ids[1] == second, "second receipt mismatch");
    }

    function testGetReceiptsByPayeeWorks() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.prank(issuer);
        bytes32 first = registry.createReceipt(
            payer,
            payee,
            token,
            10e6,
            false,
            bytes32("m1"),
            bytes32("tx1"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );
        VM.prank(issuer);
        bytes32 second = registry.createReceipt(
            address(0xCAFE),
            payee,
            token,
            20e6,
            false,
            bytes32("m2"),
            bytes32("tx2"),
            ReceiptRegistry.ReceiptType.BATCH_PAYMENT
        );

        bytes32[] memory ids = registry.getReceiptsByPayee(payee);
        require(ids.length == 2, "payee history length mismatch");
        require(ids[0] == first, "first receipt mismatch");
        require(ids[1] == second, "second receipt mismatch");
    }

    function testZeroPayerRejected() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        bool reverted;
        VM.prank(issuer);
        try registry.createReceipt(
            address(0),
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "zero payer should revert");
    }

    function testZeroPayeeRejected() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        bool reverted;
        VM.prank(issuer);
        try registry.createReceipt(
            payer,
            address(0),
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "zero payee should revert");
    }

    function testZeroTokenRejected() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        bool reverted;
        VM.prank(issuer);
        try registry.createReceipt(
            payer,
            payee,
            address(0),
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "zero token should revert");
    }

    function testZeroAmountRejected() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        bool reverted;
        VM.prank(issuer);
        try registry.createReceipt(
            payer,
            payee,
            token,
            0,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "zero amount should revert");
    }

    function testReceiptCreatedEventEmitted() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.recordLogs();
        VM.prank(issuer);
        registry.createReceipt(
            payer,
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );

        Vm.Log[] memory logs = VM.getRecordedLogs();
        bytes32 eventSig = keccak256(
            "ReceiptCreated(bytes32,address,address,address,uint256,bool,bytes32,bytes32,uint8,address,uint64)"
        );

        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == eventSig) {
                found = true;
                break;
            }
        }
        require(found, "ReceiptCreated event not emitted");
    }

    function testDuplicateReceiptCollisionAvoided() external {
        setUp();
        VM.prank(owner);
        registry.setAuthorizedIssuer(issuer, true);

        VM.prank(issuer);
        bytes32 first = registry.createReceipt(
            payer,
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );
        VM.prank(issuer);
        bytes32 second = registry.createReceipt(
            payer,
            payee,
            token,
            25e6,
            false,
            bytes32("meta"),
            bytes32("tx"),
            ReceiptRegistry.ReceiptType.SINGLE_PAYMENT
        );

        require(first != second, "receipt ids should not collide");
        require(registry.totalReceipts() == 2, "totalReceipts mismatch");
    }
}
