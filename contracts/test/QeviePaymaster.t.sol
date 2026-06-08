// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster, PostOpMode} from "../src/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "../src/interfaces/PackedUserOperation.sol";
import {QeviePaymaster} from "../src/paymaster/QeviePaymaster.sol";
import {MockEntryPoint} from "./helpers/MockEntryPoint.sol";
import {MockQUSDC} from "./helpers/MockQUSDC.sol";
import {MockDexPair} from "./helpers/MockDexPair.sol";
import {Ecdsa} from "../src/utils/Ecdsa.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function deal(address who, uint256 amount) external;
    function expectRevert() external;
}

contract QeviePaymasterTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant SIGNER_KEY = 0xA11CE1337;
    address internal signer;

    MockEntryPoint internal ep;
    MockQUSDC internal token;
    MockDexPair internal pair;
    address internal wqie;
    address internal qusdcAddr;
    QeviePaymaster internal pm;

    // 50k WQIE, 9k QUSDC → ~0.18 QUSDC per QIE
    uint112 internal constant WQIE_RESERVE = 50_000 ether;
    uint112 internal constant QUSDC_RESERVE = 9000e6;

    function setUp() internal {
        signer = VM.addr(SIGNER_KEY);

        // Warp first so all timestamps (pair reserves, paymaster dailyBudgetDay) are consistent.
        VM.warp(1_700_000_000);

        ep = new MockEntryPoint();
        token = new MockQUSDC();
        wqie = address(0x1000);
        qusdcAddr = address(token);
        pair = new MockDexPair(wqie, qusdcAddr);
        pair.setReserves(WQIE_RESERVE, QUSDC_RESERVE);

        pm = new QeviePaymaster(ep, token, wqie, pair, signer);
        pm.setAllowedTarget(address(token), true);

        // Fund the paymaster's EntryPoint deposit.
        VM.deal(address(pm), 10 ether);
        VM.prank(address(pm));
        ep.depositTo{value: 10 ether}(address(pm));
    }

    // ---------------------------------------------------------------------------
    // Helper: build a minimal UserOperation for the paymaster
    // ---------------------------------------------------------------------------

    function _buildModeAOp(address sender) internal view returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.callData = abi.encodeWithSelector(
            bytes4(0xb61d27f6), // execute(address,uint256,bytes)
            address(token),
            uint256(0),
            bytes("")
        );
        op.paymasterAndData = abi.encodePacked(
            address(pm), // [0:20]
            uint128(200_000), // paymasterVerificationGasLimit
            uint128(100_000), // paymasterPostOpGasLimit
            uint8(0x00) // Mode A
        );
    }

    function _buildModeBOp(address sender, uint32 expiry, bytes memory sig)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        // Mode B — include EXECUTE_SELECTOR + whitelisted target
        op.callData = abi.encodeWithSelector(
            bytes4(0xb61d27f6), // execute(address,uint256,bytes)
            address(token), // target = QUSDC (whitelisted below)
            uint256(0),
            bytes("")
        );
        op.paymasterAndData = abi.encodePacked(
            address(pm), // [0:20]
            uint128(200_000),
            uint128(100_000),
            uint8(0x01), // Mode B
            expiry, // 4 bytes
            sig // 65 bytes
        );
    }

    function _signAllowlist(address sender, uint32 expiry) internal returns (bytes memory sig) {
        bytes32 digest = keccak256(abi.encode(sender, expiry, block.chainid));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(SIGNER_KEY, ethDigest);
        sig = abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------------
    // Paymaster setup tests
    // ---------------------------------------------------------------------------

    function testOwnerIsDeployer() external {
        setUp();
        require(pm.owner() == address(this), "owner wrong");
    }

    function testTrustedSignerSet() external {
        setUp();
        require(pm.trustedSigner() == signer, "signer wrong");
    }

    // ---------------------------------------------------------------------------
    // Mode A: QUSDC-pay
    // ---------------------------------------------------------------------------

    function testModeAValidationPassesWithSufficientBalance() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);

        // User approves paymaster.
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (bytes memory ctx, uint256 validData) =
            pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 0, "validation should pass");
        require(ctx.length > 0, "context should not be empty");
    }

    function testModeAValidationFailsInsufficientBalance() external {
        setUp();
        address user = address(0xBEEF);
        // No QUSDC minted, no approval.

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (, uint256 validData) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 1, "should fail validation");
    }

    function testModeAValidationFailsInsufficientAllowance() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        // No approval.

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (, uint256 validData) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 1, "should fail: no allowance");
    }

    function testModeAPostOpChargesQUSDC() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        uint256 beforeBal = token.balanceOf(user);

        VM.prank(address(ep));
        pm.postOp(PostOpMode.opSucceeded, ctx, 0.05 ether, 1 gwei);

        uint256 charged = beforeBal - token.balanceOf(user);
        require(charged > 0, "should have charged QUSDC");
        require(pm.collectedQUSDC() == charged, "collected not updated");
    }

    function testModeAPostOpRevertedStillCharges() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        uint256 beforeBal = token.balanceOf(user);

        VM.prank(address(ep));
        pm.postOp(PostOpMode.opReverted, ctx, 0.05 ether, 1 gwei);

        require(token.balanceOf(user) < beforeBal, "should charge even on revert");
    }

    // ---------------------------------------------------------------------------
    // QUSDC_GAS (Mode A) sustainability config
    // ---------------------------------------------------------------------------

    function testQusdcGasDefaultConfigIsUnlimited() external {
        setUp();
        (bool enabled, uint16 markupBps, uint256 maxPerTx, uint256 dailyCap, uint256 spentToday) =
            pm.getQusdcGasStatus();
        require(enabled, "QUSDC gas should default enabled");
        require(markupBps == 2000, "default markup should be 20%");
        require(maxPerTx == 0, "per-tx cap should default unlimited");
        require(dailyCap == 0, "daily cap should default unlimited");
        require(spentToday == 0, "nothing spent yet");
    }

    function testModeAFailsWhenQusdcGasDisabled() external {
        setUp();
        pm.setQusdcGasEnabled(false);

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);
        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);
    }

    function testQusdcGasPerTxCapBlocksHighCharge() external {
        setUp();
        // For maxCost 0.1 ether the quote is ~21600 (6-dec). Set a tiny per-tx cap.
        pm.setQusdcGasCaps(1000, 0);

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);
        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);
    }

    function testQusdcGasDailyCapBlocksWhenExceeded() external {
        setUp();
        pm.setQusdcGasCaps(0, 1000); // daily cap below a single op's quote

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);
        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);
    }

    function testFundedUserAlwaysHasQusdcGasByDefault() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        (bool available, uint256 quoted, string memory reason) =
            pm.qusdcGasAvailable(user, 0.1 ether);
        require(available, "funded user should always be able to pay gas in QUSDC");
        require(quoted > 0, "quote should be non-zero");
        require(bytes(reason).length == 0, "no reason when available");
    }

    function testQusdcGasUnavailableWithoutBalance() external {
        setUp();
        address user = address(0xBEEF);
        (bool available,, string memory reason) = pm.qusdcGasAvailable(user, 0.1 ether);
        require(!available, "unfunded user has no QUSDC gas");
        require(bytes(reason).length > 0, "reason should explain why");
    }

    function testQusdcGasUnavailableWithoutAllowance() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6); // balance but no approval
        (bool available,,) = pm.qusdcGasAvailable(user, 0.1 ether);
        require(!available, "no allowance means QUSDC gas unavailable");
    }

    function testPostOpRecordsQusdcGasSpent() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);
        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);
        VM.prank(address(ep));
        pm.postOp(PostOpMode.opSucceeded, ctx, 0.05 ether, 1 gwei);

        (,,,, uint256 spentToday) = pm.getQusdcGasStatus();
        require(spentToday > 0, "daily QUSDC gas spend should be tracked");
        require(spentToday == pm.collectedQUSDC(), "spend tracks collected");
    }

    function testHigherMarkupRaisesQuote() external {
        setUp();
        uint256 baseQuote = pm.quoteQUSDC(0.1 ether);
        pm.setGasMarkupBps(5000); // 50%
        uint256 higherQuote = pm.quoteQUSDC(0.1 ether);
        require(higherQuote > baseQuote, "higher markup should raise the quote");
    }

    function testNonOwnerCannotSetQusdcGasConfig() external {
        setUp();
        VM.prank(address(0xBAD));
        VM.expectRevert();
        pm.setQusdcGasEnabled(false);
    }

    // ---------------------------------------------------------------------------
    // Mode A: stale price guard
    // ---------------------------------------------------------------------------

    function testModeAFailsOnStalePrice() external {
        setUp();
        // Age the pair timestamp by more than PRICE_STALENESS_LIMIT (3600s).
        pair.setTimestamp(uint32(block.timestamp - 3601));

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (, uint256 validData) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 1, "stale price should fail");
    }

    // ---------------------------------------------------------------------------
    // Mode A: thin pool guard
    // ---------------------------------------------------------------------------

    function testModeAFailsOnThinPool() external {
        setUp();
        // Set WQIE reserve below MIN_WQIE_RESERVE (1000 ether).
        pair.setReserves(500 ether, QUSDC_RESERVE);

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (, uint256 validData) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 1, "thin pool should fail");
    }

    // ---------------------------------------------------------------------------
    // Mode B: sponsored free tier
    // ---------------------------------------------------------------------------

    function testModeBValidationPassesWithValidSig() external {
        setUp();

        address user = address(0xCAFE);
        // Whitelist the token address as an allowed target.
        pm.setAllowedTarget(address(token), true);

        uint32 expiry = uint32(block.timestamp + 3600);
        bytes memory sig = _signAllowlist(user, expiry);

        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        (bytes memory ctx, uint256 validData) =
            pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        require(validData == 0, "should pass");
        require(ctx.length > 0, "context should not be empty");
    }

    function testModeBFailsWithExpiredSig() external {
        setUp();
        pm.setAllowedTarget(address(token), true);

        address user = address(0xCAFE);
        uint32 expiry = uint32(block.timestamp - 1);
        bytes memory sig = _signAllowlist(user, expiry);

        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function testModeBFailsWithWrongSigner() external {
        setUp();
        pm.setAllowedTarget(address(token), true);

        address user = address(0xCAFE);
        uint32 expiry = uint32(block.timestamp + 3600);

        // Sign with a different key.
        bytes32 digest = keccak256(abi.encode(user, expiry, block.chainid));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(0xDEAD, ethDigest);
        bytes memory sig = abi.encodePacked(r, s, v);

        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        (, uint256 validData) = pm.validatePaymasterUserOp(op, bytes32(0), 0);

        require(validData == 1, "wrong signer should fail");
    }

    function testModeBFailsAfterCapReached() external {
        setUp();
        pm.setAllowedTarget(address(token), true);

        address user = address(0xCAFE);

        // Exhaust the cap by repeatedly going through validation + postOp.
        for (uint256 i; i < pm.PER_ACCOUNT_CAP(); ++i) {
            uint32 expiry = uint32(block.timestamp + 3600);
            bytes memory sig = _signAllowlist(user, expiry);
            PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

            VM.prank(address(ep));
            (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(0), 0);

            VM.prank(address(ep));
            pm.postOp(PostOpMode.opSucceeded, ctx, 0.01 ether, 1 gwei);
        }

        // Next attempt should fail.
        uint32 expiry = uint32(block.timestamp + 3600);
        bytes memory sig = _signAllowlist(user, expiry);
        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function testModeBFailsWithDisallowedTarget() external {
        setUp();
        pm.setAllowedTarget(address(token), false);

        address user = address(0xCAFE);
        uint32 expiry = uint32(block.timestamp + 3600);
        bytes memory sig = _signAllowlist(user, expiry);

        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ---------------------------------------------------------------------------
    // Adversarial: drain attempt via postOp
    // ---------------------------------------------------------------------------

    function testOnlyEntryPointCanCallPostOp() external {
        setUp();
        // Attacker calls postOp directly.
        bool reverted;
        try pm.postOp(PostOpMode.opSucceeded, "", 0, 0) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-EP postOp should revert");
    }

    function testOnlyEntryPointCanCallValidate() external {
        setUp();
        PackedUserOperation memory op = _buildModeAOp(address(0xBEEF));
        bool reverted;
        try pm.validatePaymasterUserOp(op, bytes32(0), 0) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-EP validate should revert");
    }

    // ---------------------------------------------------------------------------
    // Admin controls
    // ---------------------------------------------------------------------------

    function testPausedPaymasterRejectsAllOps() external {
        setUp();
        pm.pause();

        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        pm.unpause();

        VM.prank(address(ep));
        (, uint256 validDataAfter) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);
        require(validDataAfter == 0, "unpaused should pass");
    }

    function testNonOwnerCannotPause() external {
        setUp();
        bool reverted;
        VM.prank(address(0xBAD));
        try pm.pause() {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner pause should revert");
    }

    function testOwnerCanWithdrawQUSDC() external {
        setUp();
        address user = address(0xBEEF);
        token.mint(user, 1000e6);
        VM.prank(user);
        token.approve(address(pm), 1000e6);

        PackedUserOperation memory op = _buildModeAOp(user);

        VM.prank(address(ep));
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(0), 0.1 ether);

        VM.prank(address(ep));
        pm.postOp(PostOpMode.opSucceeded, ctx, 0.1 ether, 1 gwei);

        uint256 collected = pm.collectedQUSDC();
        require(collected > 0, "nothing collected");

        address recv = address(0xFEED);
        pm.withdrawQUSDC(recv, collected);
        require(token.balanceOf(recv) == collected, "withdraw failed");
    }

    // ---------------------------------------------------------------------------
    // Daily budget reset
    // ---------------------------------------------------------------------------

    function testDailyBudgetResetsNextDay() external {
        setUp();
        pm.setAllowedTarget(address(token), true);

        address user = address(0xCAFE);

        // First op — should pass.
        uint32 expiry = uint32(block.timestamp + 3600);
        bytes memory sig = _signAllowlist(user, expiry);
        PackedUserOperation memory op = _buildModeBOp(user, expiry, sig);

        VM.prank(address(ep));
        (bytes memory ctx, uint256 validData1) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        require(validData1 == 0, "should pass");

        // Spend nearly all the daily budget.
        // Read constant before prank so the external view call doesn't consume the prank.
        uint256 dailyBudget = pm.DAILY_BUDGET_WEI();
        VM.prank(address(ep));
        pm.postOp(PostOpMode.opSucceeded, ctx, dailyBudget - 1 gwei, 1 gwei);

        // Same day — budget should be almost exhausted, new op might still pass.
        // Advance to next day.
        VM.warp(block.timestamp + 86_401);

        address user2 = address(0xD00D);
        expiry = uint32(block.timestamp + 3600);
        sig = _signAllowlist(user2, expiry);
        op = _buildModeBOp(user2, expiry, sig);

        VM.prank(address(ep));
        (, uint256 validData2) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        require(validData2 == 0, "next-day budget should reset");
    }

    // ---------------------------------------------------------------------------
    // Invalid paymasterAndData
    // ---------------------------------------------------------------------------

    function testShortPaymasterDataFailsGracefully() external {
        setUp();
        PackedUserOperation memory op;
        op.sender = address(0xBEEF);
        // Only 20 bytes (missing gasLimits and mode).
        op.paymasterAndData = abi.encodePacked(address(pm));

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function testUnknownModeFailsGracefully() external {
        setUp();
        PackedUserOperation memory op;
        op.sender = address(0xBEEF);
        op.paymasterAndData =
            abi.encodePacked(address(pm), uint128(200_000), uint128(100_000), uint8(0xFF));

        VM.prank(address(ep));
        VM.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }
}
