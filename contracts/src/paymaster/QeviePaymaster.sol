// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster, PostOpMode} from "../interfaces/IPaymaster.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "../interfaces/PackedUserOperation.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {IQIEDexPair} from "../interfaces/IQIEDexPair.sol";
import {Ecdsa} from "../utils/Ecdsa.sol";

/// @title QeviePaymaster
/// @notice ERC-4337 v0.7 paymaster for qevie gasless payments on QIE.
///
/// Two sponsorship modes encoded in paymasterAndData[52]:
///   Mode A (0x00) — QUSDC-pay: paymaster fronts native QIE for gas and collects QUSDC
///                   from the user's smart account in postOp. Self-sustaining.
///   Mode B (0x01) — Sponsored: paymaster covers gas entirely from its own QIE deposit.
///                   Strictly capped, Sybil-gated, scoped to qevie contracts only.
///
/// paymasterAndData layout (ERC-4337 v0.7):
///   [0   :20]  paymaster address
///   [20  :36]  paymasterVerificationGasLimit (uint128 big-endian, part of EntryPoint header)
///   [36  :52]  paymasterPostOpGasLimit       (uint128 big-endian, part of EntryPoint header)
///   [52  :53]  mode byte
///   Mode A extra: none (QUSDC pulled from account in postOp)
///   Mode B extra:
///   [53  :57]  expiry (uint32, unix timestamp, max 48h from now)
///   [57  :122] allowlist signature (65 bytes: r|s|v) over keccak256(abi.encode(sender, expiry, chainId))
///
/// Security:
///   - Reentrancy guard on postOp (funds movement).
///   - Owner-controlled pause halts all new sponsorships.
///   - Hard per-account and per-day caps in Mode B.
///   - Mode B only sponsors calls to whitelisted qevie contracts.
///   - Mode A uses conservative DEX spot price + 20% markup to prevent losses.
///   - Price staleness check: pair last-update must be within PRICE_STALENESS_LIMIT.
///   - Minimum liquidity check to reject thin/griefable pools.
///   - Pull-don't-push: never sends QIE to external addresses in postOp.
contract QeviePaymaster is IPaymaster {
    using Ecdsa for bytes32;

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------

    /// @notice Mode A: charge user in QUSDC to cover gas.
    uint8 internal constant MODE_QUSDC = 0x00;
    /// @notice Mode B: sponsor gas from paymaster deposit (free tier).
    uint8 internal constant MODE_SPONSORED = 0x01;

    /// @notice Default markup applied on top of DEX spot price in Mode A (20% = 2000 bps).
    uint16 internal constant DEFAULT_GAS_MARKUP_BPS = 2000;
    /// @notice Basis-points denominator.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Maximum age of DEX reserve data before we reject quoting (1 hour).
    uint32 internal constant PRICE_STALENESS_LIMIT = 3600;

    /// @notice Minimum WQIE reserve required to trust the DEX price ($1k+ at current rates).
    uint256 internal constant MIN_WQIE_RESERVE = 1000 ether;

    /// @notice Free ops granted per account in Mode B (lifetime).
    uint256 public constant PER_ACCOUNT_CAP = 3;

    /// @notice Maximum native QIE (in wei) the paymaster will sponsor per calendar day.
    uint256 public constant DAILY_BUDGET_WEI = 5 ether;

    /// @notice Maximum native QIE (in wei) the paymaster will ever sponsor in total.
    uint256 public constant GLOBAL_BUDGET_WEI = 100 ether;

    /// @notice Maximum validity window for a Mode B allowlist signature (48 hours).
    uint32 internal constant MAX_EXPIRY_WINDOW = 172_800;

    /// @notice Minimum buffer we require remaining in the EntryPoint deposit before accepting ops.
    uint256 internal constant MIN_DEPOSIT_BUFFER = 0.01 ether;

    /// @notice Validation failed sentinel per ERC-4337 spec.
    uint256 internal constant VALIDATION_FAILED = 1;
    uint256 internal constant VALIDATION_OK = 0;

    /// @notice Reentrancy guard states.
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    /// @notice selector of QevieSmartAccount.execute(address,uint256,bytes).
    bytes4 internal constant EXECUTE_SELECTOR = 0xb61d27f6;
    /// @notice selector of QevieSmartAccount.executeBatch(address[],uint256[],bytes[]).
    bytes4 internal constant EXECUTE_BATCH_SELECTOR = 0x47e1da2a;
    /// @notice selector of QevieSmartAccount.executeSession(bytes32,address,uint256,bytes).
    bytes4 internal constant EXECUTE_SESSION_SELECTOR = 0x40a3f0bf;
    /// @notice selector of QevieSmartAccount.executeSessionBatch(bytes32,address[],uint256[],bytes[]).
    bytes4 internal constant EXECUTE_SESSION_BATCH_SELECTOR = 0x3d954a7d;

    // ---------------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------------

    /// @notice The trusted ERC-4337 EntryPoint.
    IEntryPoint public immutable entryPoint;

    /// @notice QUSDC token contract (6 decimals).
    IERC20 public immutable qusdc;

    /// @notice WQIE/QUSDC DEX pair for on-chain price derivation.
    IQIEDexPair public immutable dexPair;

    /// @notice WQIE token address (verified: 0x0087904D95BEe9E5F24dc8852804b547981A9139).
    address public immutable wqie;

    /// @notice True when WQIE is token0 of the DEX pair (false means token1).
    bool public immutable wqieIsToken0;

    // ---------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------

    /// @notice Contract owner with admin controls.
    address public owner;

    /// @notice Off-chain service address whose signature gates Mode B free tier.
    address public trustedSigner;

    /// @notice True when the paymaster is paused (no new ops accepted).
    bool public paused;

    /// @notice Lifetime free ops sponsored per smart account in Mode B.
    mapping(address => uint256) public sponsoredOpsCount;

    /// @notice Calendar day (block.timestamp / 86400) for daily budget tracking.
    uint256 public dailyBudgetDay;

    /// @notice Native QIE (wei) spent on sponsorships today.
    uint256 public dailyBudgetSpent;

    /// @notice Total native QIE (wei) ever spent on sponsorships.
    uint256 public globalBudgetSpent;

    /// @notice Addresses allowed as call targets in Mode B.
    mapping(address => bool) public allowedTargets;

    /// @notice Reentrancy guard for postOp.
    uint256 private _reentrancyStatus;

    /// @notice QUSDC collected via Mode A charges (withdrawable by owner).
    uint256 public collectedQUSDC;

    // --- Mode B (QUSDC_GAS) sustainability config ---------------------------

    /// @notice Master switch for Mode A / QUSDC_GAS. When false the paymaster
    ///         will not front gas against QUSDC and the off-chain layer must
    ///         surface QUSDC Gas as unavailable.
    bool public qusdcGasEnabled;

    /// @notice Markup (basis points) added on top of the DEX spot price when
    ///         pricing native QIE gas in QUSDC. Owner-tunable; default 2000 (20%).
    uint16 public gasMarkupBps;

    /// @notice Maximum QUSDC (6-dec) chargeable for a single op's gas. 0 = unlimited.
    uint256 public maxQusdcGasPerTx;

    /// @notice Maximum QUSDC (6-dec) chargeable for gas across all accounts per
    ///         calendar day. 0 = unlimited.
    uint256 public dailyQusdcGasCap;

    /// @notice Calendar day (block.timestamp / 86400) for the QUSDC-gas daily cap.
    uint256 public qusdcGasDay;

    /// @notice QUSDC (6-dec) charged for gas so far today.
    uint256 public qusdcGasSpentToday;

    // ---------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------

    event ModeACharge(address indexed account, uint256 qusdcCharged, uint256 gasCostWei);
    event QusdcGasConfigUpdated(bool enabled, uint16 markupBps, uint256 maxPerTx, uint256 dailyCap);
    event ModeBSponsored(address indexed account, uint256 gasCostWei, uint256 remainingOps);
    event TargetAllowed(address indexed target, bool allowed);
    event TrustedSignerUpdated(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event QUSDCWithdrawn(address indexed to, uint256 amount);
    event DepositWithdrawn(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------

    error NotEntryPoint();
    error NotOwner();
    error IsPaused();
    error InvalidMode();
    error InsufficientQUSDCBalance(uint256 required, uint256 available);
    error InsufficientQUSDCAllowance(uint256 required, uint256 approved);
    error QusdcGasDisabled();
    error QusdcChargeAboveCap(uint256 quoted, uint256 cap);
    error DailyQusdcGasCapExceeded();
    error QUSDCTransferFailed();
    error AccountCapReached(address account);
    error DailyBudgetExhausted();
    error GlobalBudgetExhausted();
    error ExpiredAllowlistSig();
    error InvalidAllowlistSig();
    error FutureExpiry();
    error DisallowedTarget(address target);
    error StalePrice();
    error ThinPool();
    error ReentrantCall();
    error ZeroAddress();
    error WithdrawFailed();
    error InvalidPaymasterData();

    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------

    /// @param anEntryPoint The trusted ERC-4337 EntryPoint v0.7.
    /// @param aQUSDC QUSDC token contract (verified: 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5).
    /// @param aWQIE WQIE token address (verified: 0x0087904D95BEe9E5F24dc8852804b547981A9139).
    /// @param aDexPair WQIE/QUSDC DEX pair (verified: 0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe).
    /// @param initialTrustedSigner Off-chain paymaster-service signing address.
    constructor(
        IEntryPoint anEntryPoint,
        IERC20 aQUSDC,
        address aWQIE,
        IQIEDexPair aDexPair,
        address initialTrustedSigner
    ) {
        if (
            address(anEntryPoint) == address(0) || address(aQUSDC) == address(0)
                || aWQIE == address(0) || address(aDexPair) == address(0)
                || initialTrustedSigner == address(0)
        ) {
            revert ZeroAddress();
        }

        entryPoint = anEntryPoint;
        qusdc = aQUSDC;
        wqie = aWQIE;
        dexPair = aDexPair;
        wqieIsToken0 = (aDexPair.token0() == aWQIE);
        trustedSigner = initialTrustedSigner;
        owner = msg.sender;
        _reentrancyStatus = _NOT_ENTERED;
        dailyBudgetDay = block.timestamp / 86_400;

        // QUSDC_GAS defaults: enabled, 20% markup, NO per-tx or daily caps.
        // A funded user (holds QUSDC + has approved the paymaster) can always
        // pay gas in QUSDC; caps are opt-in safety knobs the owner may set later.
        qusdcGasEnabled = true;
        gasMarkupBps = DEFAULT_GAS_MARKUP_BPS;
        maxQusdcGasPerTx = 0; // 0 == unlimited
        dailyQusdcGasCap = 0; // 0 == unlimited
        qusdcGasDay = block.timestamp / 86_400;
    }

    // ---------------------------------------------------------------------------
    // Receive — accept native QIE for EntryPoint deposit funding
    // ---------------------------------------------------------------------------

    receive() external payable {}

    // ---------------------------------------------------------------------------
    // IPaymaster — validatePaymasterUserOp
    // ---------------------------------------------------------------------------

    /// @inheritdoc IPaymaster
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32, /* userOpHash */
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        _requireEntryPoint();
        if (paused) {
            revert IsPaused();
        }

        bytes calldata paymasterData = userOp.paymasterAndData;

        // paymasterAndData must be at least 53 bytes: 20 addr + 16 gasLimits + ... + 1 mode
        if (paymasterData.length < 53) {
            revert InvalidPaymasterData();
        }

        uint8 mode = uint8(paymasterData[52]);

        if (mode == MODE_QUSDC) {
            return _validateModeA(userOp, maxCost);
        } else if (mode == MODE_SPONSORED) {
            return _validateModeB(userOp);
        } else {
            revert InvalidMode();
        }
    }

    // ---------------------------------------------------------------------------
    // IPaymaster — postOp
    // ---------------------------------------------------------------------------

    /// @inheritdoc IPaymaster
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    )
        external
        override
    {
        _requireEntryPoint();
        _nonReentrantBefore();

        if (context.length < 32) {
            _nonReentrantAfter();
            return;
        }

        // context is abi.encode(uint8(mode), ...). The mode uint8 is right-aligned in the
        // first 32-byte ABI slot, so we load the full word and truncate to uint8.
        uint8 payMode;
        assembly {
            payMode := calldataload(context.offset)
        }

        if (payMode == MODE_QUSDC) {
            _postOpModeA(mode, context, actualGasCost);
        } else if (payMode == MODE_SPONSORED) {
            _postOpModeB(context, actualGasCost);
        }

        _nonReentrantAfter();
    }

    // ---------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------

    /// @notice Deposit native QIE into the EntryPoint for gas sponsorship.
    function depositToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /// @notice Withdraw the EntryPoint deposit. Only owner.
    function withdrawFromEntryPoint(address payable to, uint256 amount) external {
        _requireOwner();
        if (to == address(0)) revert ZeroAddress();
        entryPoint.withdrawTo(to, amount);
        emit DepositWithdrawn(to, amount);
    }

    /// @notice Withdraw collected QUSDC from Mode A charges. Only owner.
    function withdrawQUSDC(address to, uint256 amount) external {
        _requireOwner();
        if (to == address(0)) revert ZeroAddress();
        collectedQUSDC -= amount;
        bool ok = qusdc.transfer(to, amount);
        if (!ok) revert WithdrawFailed();
        emit QUSDCWithdrawn(to, amount);
    }

    /// @notice Allow or disallow a call target for Mode B sponsorship.
    function setAllowedTarget(address target, bool allowed) external {
        _requireOwner();
        if (target == address(0)) revert ZeroAddress();
        allowedTargets[target] = allowed;
        emit TargetAllowed(target, allowed);
    }

    /// @notice Enable or disable QUSDC_GAS (Mode A). When disabled the off-chain
    ///         layer surfaces QUSDC Gas as unavailable and Autopilot pauses.
    function setQusdcGasEnabled(bool enabled) external {
        _requireOwner();
        qusdcGasEnabled = enabled;
        emit QusdcGasConfigUpdated(enabled, gasMarkupBps, maxQusdcGasPerTx, dailyQusdcGasCap);
    }

    /// @notice Set the QUSDC-gas pricing markup in basis points (max 100% = 10000).
    function setGasMarkupBps(uint16 markupBps) external {
        _requireOwner();
        if (markupBps > BPS_DENOMINATOR) revert InvalidPaymasterData();
        gasMarkupBps = markupBps;
        emit QusdcGasConfigUpdated(qusdcGasEnabled, markupBps, maxQusdcGasPerTx, dailyQusdcGasCap);
    }

    /// @notice Set optional QUSDC-gas safety ceilings (0 == unlimited for either).
    ///         Unlimited by default: a funded user can always pay gas in QUSDC.
    function setQusdcGasCaps(uint256 perTx, uint256 dailyCap) external {
        _requireOwner();
        maxQusdcGasPerTx = perTx;
        dailyQusdcGasCap = dailyCap;
        emit QusdcGasConfigUpdated(qusdcGasEnabled, gasMarkupBps, perTx, dailyCap);
    }

    /// @notice Update the trusted signer that issues Mode B allowlist tokens.
    function setTrustedSigner(address next) external {
        _requireOwner();
        if (next == address(0)) revert ZeroAddress();
        emit TrustedSignerUpdated(trustedSigner, next);
        trustedSigner = next;
    }

    /// @notice Transfer contract ownership.
    function transferOwnership(address next) external {
        _requireOwner();
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /// @notice Pause all new sponsorships immediately (emergency).
    function pause() external {
        _requireOwner();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume sponsorships.
    function unpause() external {
        _requireOwner();
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ---------------------------------------------------------------------------
    // View helpers
    // ---------------------------------------------------------------------------

    /// @notice Quote how many QUSDC units (6-dec) will be charged for a given gas cost in wei.
    /// @param gasCostWei Estimated gas cost in native QIE (wei).
    function quoteQUSDC(uint256 gasCostWei) external view returns (uint256 qusdcAmount) {
        (uint256 reserveWQIE, uint256 reserveQUSDC,) = _getReserves();
        qusdcAmount = _quoteQUSDC(gasCostWei, reserveWQIE, reserveQUSDC);
    }

    /// @notice Return remaining free-tier ops for an account in Mode B.
    function remainingFreeOps(address account) external view returns (uint256) {
        uint256 used = sponsoredOpsCount[account];
        if (used >= PER_ACCOUNT_CAP) return 0;
        return PER_ACCOUNT_CAP - used;
    }

    /// @notice Whether a given account can pay gas in QUSDC right now for a
    ///         worst-case gas cost, and the QUSDC that would be charged.
    /// @dev Mirrors the Mode A validation gates so the off-chain layer can show
    ///      an honest "QUSDC Gas available / unavailable" state and a quote.
    /// @return available True if QUSDC_GAS would pass validation.
    /// @return quotedQUSDC The QUSDC (6-dec) that would be charged for maxGasCostWei.
    /// @return reason Empty if available, else a short human-readable reason.
    function qusdcGasAvailable(address account, uint256 maxGasCostWei)
        external
        view
        returns (bool available, uint256 quotedQUSDC, string memory reason)
    {
        if (!qusdcGasEnabled) return (false, 0, "QUSDC Gas is disabled");

        (uint256 reserveWQIE, uint256 reserveQUSDC, uint32 lastUpdate) = _getReserves();
        if (block.timestamp > uint256(lastUpdate) + PRICE_STALENESS_LIMIT) {
            return (false, 0, "QIEDex quote is stale");
        }
        if (reserveWQIE < MIN_WQIE_RESERVE) {
            return (false, 0, "QIEDex liquidity too thin");
        }

        quotedQUSDC = _quoteQUSDC(maxGasCostWei, reserveWQIE, reserveQUSDC);

        if (maxQusdcGasPerTx != 0 && quotedQUSDC > maxQusdcGasPerTx) {
            return (false, quotedQUSDC, "Gas charge exceeds per-tx cap");
        }
        if (dailyQusdcGasCap != 0) {
            uint256 spentToday = (block.timestamp / 86_400 == qusdcGasDay) ? qusdcGasSpentToday : 0;
            if (spentToday + quotedQUSDC > dailyQusdcGasCap) {
                return (false, quotedQUSDC, "Daily QUSDC gas cap reached");
            }
        }
        if (qusdc.balanceOf(account) < quotedQUSDC) {
            return (false, quotedQUSDC, "Insufficient QUSDC balance");
        }
        if (qusdc.allowance(account, address(this)) < quotedQUSDC) {
            return (false, quotedQUSDC, "QUSDC gas allowance not approved");
        }
        return (true, quotedQUSDC, "");
    }

    /// @notice Return the current QUSDC_GAS configuration and today's usage.
    function getQusdcGasStatus()
        external
        view
        returns (
            bool enabled,
            uint16 markupBps,
            uint256 maxPerTx,
            uint256 dailyCap,
            uint256 spentToday
        )
    {
        enabled = qusdcGasEnabled;
        markupBps = gasMarkupBps;
        maxPerTx = maxQusdcGasPerTx;
        dailyCap = dailyQusdcGasCap;
        spentToday = (block.timestamp / 86_400 == qusdcGasDay) ? qusdcGasSpentToday : 0;
    }

    // ---------------------------------------------------------------------------
    // Internal — Mode A (QUSDC-pay) validation
    // ---------------------------------------------------------------------------

    function _validateModeA(PackedUserOperation calldata userOp, uint256 maxCost)
        private
        view
        returns (bytes memory context, uint256 validationData)
    {
        // QUSDC_GAS must be enabled by the owner.
        if (!qusdcGasEnabled) {
            revert QusdcGasDisabled();
        }

        (uint256 reserveWQIE, uint256 reserveQUSDC, uint32 lastUpdate) = _getReserves();

        // Staleness check — no fresh QIEDex quote, so QUSDC_GAS is unavailable.
        if (block.timestamp > uint256(lastUpdate) + PRICE_STALENESS_LIMIT) {
            return ("", VALIDATION_FAILED);
        }

        // Minimum liquidity check to prevent price manipulation.
        if (reserveWQIE < MIN_WQIE_RESERVE) {
            return ("", VALIDATION_FAILED);
        }

        uint256 quotedQUSDC = _quoteQUSDC(maxCost, reserveWQIE, reserveQUSDC);

        // Optional owner-set safety ceilings (0 == unlimited). By default these
        // are unlimited: a funded user can always pay gas in QUSDC.
        if (maxQusdcGasPerTx != 0 && quotedQUSDC > maxQusdcGasPerTx) {
            revert QusdcChargeAboveCap(quotedQUSDC, maxQusdcGasPerTx);
        }
        if (dailyQusdcGasCap != 0) {
            uint256 spentToday = (block.timestamp / 86_400 == qusdcGasDay) ? qusdcGasSpentToday : 0;
            if (spentToday + quotedQUSDC > dailyQusdcGasCap) {
                revert DailyQusdcGasCapExceeded();
            }
        }

        address sender = userOp.sender;

        // Validate the user's QUSDC balance and allowance cover the worst-case charge.
        _requireCallAllowed(userOp.callData);

        uint256 balance = qusdc.balanceOf(sender);
        if (balance < quotedQUSDC) {
            return ("", VALIDATION_FAILED);
        }

        uint256 approved = qusdc.allowance(sender, address(this));
        if (approved < quotedQUSDC) {
            return ("", VALIDATION_FAILED);
        }

        // context: mode byte + sender + quotedQUSDC (used as a cap in postOp)
        context = abi.encode(MODE_QUSDC, sender, quotedQUSDC);
        validationData = VALIDATION_OK;
    }

    // ---------------------------------------------------------------------------
    // Internal — Mode B (sponsored) validation
    // ---------------------------------------------------------------------------

    function _validateModeB(PackedUserOperation calldata userOp)
        private
        returns (bytes memory context, uint256 validationData)
    {
        bytes calldata extra = userOp.paymasterAndData[53:];

        // Decode expiry + signature (4 + 65 = 69 extra bytes required).
        if (extra.length < 69) {
            revert InvalidPaymasterData();
        }

        uint32 expiry = uint32(bytes4(extra[0:4]));
        bytes memory sig = extra[4:69];

        // Validate expiry.
        uint256 now_ = block.timestamp;
        if (expiry < now_) {
            revert ExpiredAllowlistSig();
        }
        if (expiry > now_ + MAX_EXPIRY_WINDOW) {
            revert FutureExpiry();
        }

        address sender = userOp.sender;

        // Verify off-chain allowlist signature: covers (sender, expiry, block.chainid).
        bytes32 digest = keccak256(abi.encode(sender, expiry, block.chainid));
        bytes32 ethDigest = Ecdsa.toEthSignedMessageHash(digest);
        address recovered = Ecdsa.tryRecover(ethDigest, sig);
        if (recovered != trustedSigner) {
            return ("", VALIDATION_FAILED);
        }

        // Check per-account cap.
        if (sponsoredOpsCount[sender] >= PER_ACCOUNT_CAP) {
            revert AccountCapReached(sender);
        }

        // Check daily budget (reset if new day).
        _refreshDailyBudget();
        if (dailyBudgetSpent >= DAILY_BUDGET_WEI) {
            revert DailyBudgetExhausted();
        }

        // Check global budget.
        if (globalBudgetSpent >= GLOBAL_BUDGET_WEI) {
            revert GlobalBudgetExhausted();
        }

        // Scope check: only sponsor calls to whitelisted targets.
        _requireCallAllowed(userOp.callData);

        // context: mode byte + sender (to commit in postOp)
        context = abi.encode(MODE_SPONSORED, sender);
        validationData = VALIDATION_OK;
    }

    // ---------------------------------------------------------------------------
    // Internal — postOp handlers
    // ---------------------------------------------------------------------------

    function _postOpModeA(PostOpMode, bytes calldata context, uint256 actualGasCost) private {
        (, address sender, uint256 maxQuotedQUSDC) = abi.decode(context, (uint8, address, uint256));

        // Recompute actual QUSDC charge from actual gas cost (fresh price, capped to maxQuoted).
        (uint256 reserveWQIE, uint256 reserveQUSDC,) = _getReserves();
        uint256 actualQUSDC = _quoteQUSDC(actualGasCost, reserveWQIE, reserveQUSDC);
        if (actualQUSDC > maxQuotedQUSDC) {
            actualQUSDC = maxQuotedQUSDC;
        }

        if (actualQUSDC == 0) return;

        bool ok = qusdc.transferFrom(sender, address(this), actualQUSDC);
        if (!ok) revert QUSDCTransferFailed();

        collectedQUSDC += actualQUSDC;

        // Track QUSDC charged for gas today (drives the optional daily cap and
        // off-chain sustainability reporting). The QUSDC collected here is what
        // the owner rebalances back into native QIE via the QIEDex.
        _refreshQusdcGasDay();
        qusdcGasSpentToday += actualQUSDC;

        emit ModeACharge(sender, actualQUSDC, actualGasCost);
    }

    function _postOpModeB(bytes calldata context, uint256 actualGasCost) private {
        (, address sender) = abi.decode(context, (uint8, address));

        // Commit the sponsored op: increment counter and daily spend.
        sponsoredOpsCount[sender] += 1;
        _refreshDailyBudget();
        dailyBudgetSpent += actualGasCost;
        globalBudgetSpent += actualGasCost;

        uint256 remaining = sponsoredOpsCount[sender] < PER_ACCOUNT_CAP
            ? PER_ACCOUNT_CAP - sponsoredOpsCount[sender]
            : 0;
        emit ModeBSponsored(sender, actualGasCost, remaining);
    }

    // ---------------------------------------------------------------------------
    // Internal — price helpers
    // ---------------------------------------------------------------------------

    /// @dev Fetch DEX pair reserves ordering WQIE and QUSDC correctly regardless of token order.
    function _getReserves()
        private
        view
        returns (uint256 reserveWQIE, uint256 reserveQUSDC, uint32 lastUpdate)
    {
        (uint112 r0, uint112 r1, uint32 ts) = dexPair.getReserves();
        if (wqieIsToken0) {
            reserveWQIE = uint256(r0);
            reserveQUSDC = uint256(r1);
        } else {
            reserveWQIE = uint256(r1);
            reserveQUSDC = uint256(r0);
        }
        lastUpdate = ts;
    }

    /// @dev Convert native QIE (wei) to QUSDC units (6 decimals) at spot + markup.
    ///      Formula: qusdc = gasCostWei * reserveQUSDC * (10000 + gasMarkupBps)
    ///                         / (reserveWQIE * 10000)
    ///      Prices gas along the QIEDex WQIE/QUSDC route (reserves from the pair).
    ///      Safe because reserveWQIE and reserveQUSDC are verified non-zero by MIN_WQIE_RESERVE check.
    function _quoteQUSDC(uint256 gasCostWei, uint256 reserveWQIE, uint256 reserveQUSDC)
        private
        view
        returns (uint256)
    {
        if (reserveWQIE == 0) return 0;
        return gasCostWei * reserveQUSDC * (BPS_DENOMINATOR + gasMarkupBps)
            / (reserveWQIE * BPS_DENOMINATOR);
    }

    // ---------------------------------------------------------------------------
    // Internal — scope restriction check
    // ---------------------------------------------------------------------------

    /// @dev Revert unless all call targets in the userOp callData are whitelisted.
    function _requireCallAllowed(bytes calldata callData) private view {
        if (callData.length < 4) {
            if (!allowedTargets[address(0)]) revert DisallowedTarget(address(0));
            return;
        }

        bytes4 sel = bytes4(callData[:4]);

        if (sel == EXECUTE_SELECTOR) {
            if (callData.length < 36) revert InvalidPaymasterData();
            address target = address(uint160(uint256(bytes32(callData[4:36]))));
            if (!allowedTargets[target]) revert DisallowedTarget(target);
            return;
        }

        if (sel == EXECUTE_SESSION_SELECTOR) {
            if (callData.length < 68) revert InvalidPaymasterData();
            address target = address(uint160(uint256(bytes32(callData[36:68]))));
            if (!allowedTargets[target]) revert DisallowedTarget(target);
            return;
        }

        if (sel == EXECUTE_BATCH_SELECTOR) {
            // Decode targets array from the first ABI array slot.
            // callData = selector(4) + ABI-encoded (address[], uint256[], bytes[])
            // The first param is a dynamic array; its offset is at callData[4:36].
            if (callData.length < 68) revert InvalidPaymasterData();
            uint256 targetsOffset = uint256(bytes32(callData[4:36]));
            uint256 base = 4 + targetsOffset;
            if (callData.length < base + 32) revert InvalidPaymasterData();
            uint256 len = uint256(bytes32(callData[base:base + 32]));
            if (callData.length < base + 32 + len * 32) revert InvalidPaymasterData();
            for (uint256 i; i < len; ++i) {
                address t = address(
                    uint160(uint256(bytes32(callData[base + 32 + i * 32:base + 64 + i * 32])))
                );
                if (!allowedTargets[t]) revert DisallowedTarget(t);
            }
            return;
        }

        if (sel == EXECUTE_SESSION_BATCH_SELECTOR) {
            if (callData.length < 100) revert InvalidPaymasterData();
            uint256 targetsOffset = uint256(bytes32(callData[36:68]));
            uint256 base = 4 + targetsOffset;
            if (callData.length < base + 32) revert InvalidPaymasterData();
            uint256 len = uint256(bytes32(callData[base:base + 32]));
            if (callData.length < base + 32 + len * 32) revert InvalidPaymasterData();
            for (uint256 i; i < len; ++i) {
                address t = address(
                    uint160(uint256(bytes32(callData[base + 32 + i * 32:base + 64 + i * 32])))
                );
                if (!allowedTargets[t]) revert DisallowedTarget(t);
            }
            return;
        }

        revert InvalidPaymasterData();
    }

    // ---------------------------------------------------------------------------
    // Internal — daily budget reset
    // ---------------------------------------------------------------------------

    function _refreshDailyBudget() private {
        uint256 today = block.timestamp / 86_400;
        if (today != dailyBudgetDay) {
            dailyBudgetDay = today;
            dailyBudgetSpent = 0;
        }
    }

    function _refreshQusdcGasDay() private {
        uint256 today = block.timestamp / 86_400;
        if (today != qusdcGasDay) {
            qusdcGasDay = today;
            qusdcGasSpentToday = 0;
        }
    }

    // ---------------------------------------------------------------------------
    // Internal — access guards
    // ---------------------------------------------------------------------------

    function _requireEntryPoint() private view {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
    }

    function _requireOwner() private view {
        if (msg.sender != owner) revert NotOwner();
    }

    function _nonReentrantBefore() private {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _reentrancyStatus = _NOT_ENTERED;
    }
}
