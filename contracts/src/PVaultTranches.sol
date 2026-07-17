// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {Operated} from "./Operated.sol";
import {IERC20} from "./PerpVault.sol";

/// @notice PVault structured liquidity: Senior ("the Shielded", first-out, 8% floor / 12%
/// target APY) and Junior ("the Shield", first-loss, leveraged upside) share one trading
/// book at structurally different risk (Playbook §2.6).
///
/// Mechanics implemented here:
///  - share accounting per tranche, with a GENERATION counter so a wiped tranche's shares
///    are void and recapitalization starts clean;
///  - 24h epoch settlement: operator reports house PnL; the waterfall routes it;
///  - dynamic yield curve: junior below 15% of TVL → ALL profit routes to junior;
///  - senior yield reserve: 15% of residual profit accrues to a reserve backing the floor;
///  - catastrophe mode: junior wiped → senior absorbs, senior exits pay 1% fee credited to
///    junior recap, reduce-only is signaled venue-side; exits when junior ≥ 10% of senior;
///  - junior 48h lock-up (per-deposit refresh — TESTNET simplification);
///  - senior concentration guard: holders above 5% of the tranche may withdraw at most 25%
///    of their position per call (TESTNET simplification of the 14-day rolling cap).
///
/// Conservation invariant (asserted continuously in tests):
///   usdc.balanceOf(this) == seniorNav + juniorNav + yieldReserve
contract PVaultTranches is Operated {
    IERC20 public immutable usdc;

    struct TranchePosition {
        uint256 shares;
        uint64 gen;
        uint64 unlockAt; // junior only
    }

    // --- senior ---
    uint256 public seniorNav;
    uint256 public totalSeniorShares;
    uint64 public seniorGen;
    mapping(address => TranchePosition) public senior;

    // --- junior ---
    uint256 public juniorNav;
    uint256 public totalJuniorShares;
    uint64 public juniorGen;
    mapping(address => TranchePosition) public junior;

    uint256 public yieldReserve;
    uint64 public epochId;
    bool public catastropheMode;
    bool public insolvent;

    uint16 public constant SENIOR_TARGET_APY_BPS = 1200; // 12% target (8% floor backed by reserve)
    uint16 public constant RESERVE_CUT_BPS = 1500; // 15% of residual profit → reserve
    uint16 public constant JUNIOR_MIN_RATIO_BPS = 1500; // junior < 15% of TVL → yield curve kicks in
    uint16 public constant SENIOR_EXIT_FEE_BPS = 100; // 1% exit fee during catastrophe → junior recap
    uint16 public constant RECOVERY_RATIO_BPS = 1000; // junior ≥ 10% of senior → exit catastrophe
    uint16 public constant CONCENTRATION_BPS = 500; // >5% holders face the per-call cap
    uint64 public constant JUNIOR_LOCKUP = 48 hours;

    event SeniorDeposited(address indexed user, uint256 amount, uint256 shares);
    event JuniorDeposited(address indexed user, uint256 amount, uint256 shares, uint64 unlockAt);
    event SeniorWithdrawn(address indexed user, uint256 shares, uint256 value, uint256 exitFee);
    event JuniorWithdrawn(address indexed user, uint256 shares, uint256 value);
    event EpochSettled(
        uint64 indexed epochId,
        int256 pnl,
        uint256 seniorAccrual,
        int256 juniorDelta,
        uint256 reserveDelta,
        bool catastropheMode
    );
    event JuniorWiped(uint64 newGen);
    event CatastropheEntered(uint64 indexed epochId);
    event CatastropheExited(uint64 indexed epochId);
    event InsolvencyDeclared(uint64 indexed epochId, uint256 uncovered);

    error ZeroAmount();
    error Locked();
    error NoShares();
    error ConcentrationCap();
    error TransferFailed();
    error Insolvent();

    constructor(address operator_, address usdc_) Operated(operator_) {
        usdc = IERC20(usdc_);
    }

    // ---------- views ----------

    function juniorRatioBps() public view returns (uint256) {
        uint256 tvl = seniorNav + juniorNav;
        if (tvl == 0) return 0;
        return (juniorNav * 10_000) / tvl;
    }

    function sharesOfSenior(address u) public view returns (uint256) {
        TranchePosition memory p = senior[u];
        return p.gen == seniorGen ? p.shares : 0;
    }

    function sharesOfJunior(address u) public view returns (uint256) {
        TranchePosition memory p = junior[u];
        return p.gen == juniorGen ? p.shares : 0;
    }

    function trancheState()
        external
        view
        returns (
            uint256 _seniorNav,
            uint256 _juniorNav,
            uint256 _yieldReserve,
            uint256 _totalSeniorShares,
            uint256 _totalJuniorShares,
            uint64 _epochId,
            bool _catastropheMode,
            uint256 _juniorRatioBps
        )
    {
        return (seniorNav, juniorNav, yieldReserve, totalSeniorShares, totalJuniorShares, epochId, catastropheMode, juniorRatioBps());
    }

    // ---------- deposits ----------

    function depositSenior(uint256 amount) external notInsolvent {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 shares = _mintShares(senior[msg.sender], amount, seniorNav, totalSeniorShares, seniorGen);
        totalSeniorShares += shares;
        seniorNav += amount;
        emit SeniorDeposited(msg.sender, amount, shares);
    }

    function depositJunior(uint256 amount) external notInsolvent {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        TranchePosition storage p = junior[msg.sender];
        uint256 shares = _mintShares(p, amount, juniorNav, totalJuniorShares, juniorGen);
        totalJuniorShares += shares;
        juniorNav += amount;
        p.unlockAt = uint64(block.timestamp) + JUNIOR_LOCKUP; // TESTNET: refresh-on-deposit
        emit JuniorDeposited(msg.sender, amount, shares, p.unlockAt);
    }

    function _mintShares(TranchePosition storage p, uint256 amount, uint256 nav, uint256 totalShares, uint64 gen)
        internal
        returns (uint256 shares)
    {
        if (p.gen != gen) {
            // stale generation: prior shares were voided by a wipe
            p.shares = 0;
            p.gen = gen;
        }
        // NOTE: after a wipe, nav can be > 0 with totalShares == 0 (catastrophe exit fees
        // accrued to the tranche). The first recap depositor mints against that surplus —
        // this IS the recapitalization-window bonus (Playbook §2.6), intentionally.
        shares = (totalShares == 0 || nav == 0) ? amount : (amount * totalShares) / nav;
        p.shares += shares;
    }

    // ---------- withdrawals ----------

    function withdrawSenior(uint256 shares) external notInsolvent {
        TranchePosition storage p = senior[msg.sender];
        if (p.gen != seniorGen || p.shares < shares || shares == 0) revert NoShares();
        // concentration guard for large holders (>5% of tranche): max 25% of position per call
        if (p.shares * 10_000 > totalSeniorShares * CONCENTRATION_BPS) {
            if (shares * 4 > p.shares) revert ConcentrationCap();
        }
        uint256 value = (shares * seniorNav) / totalSeniorShares;
        p.shares -= shares;
        totalSeniorShares -= shares;
        seniorNav -= value;

        uint256 fee = 0;
        if (catastropheMode) {
            fee = (value * SENIOR_EXIT_FEE_BPS) / 10_000; // funds junior recapitalization
            juniorNav += fee;
            value -= fee;
        }
        if (!usdc.transfer(msg.sender, value)) revert TransferFailed();
        emit SeniorWithdrawn(msg.sender, shares, value, fee);
    }

    function withdrawJunior(uint256 shares) external notInsolvent {
        TranchePosition storage p = junior[msg.sender];
        if (p.gen != juniorGen || p.shares < shares || shares == 0) revert NoShares();
        if (block.timestamp < p.unlockAt) revert Locked();
        uint256 value = (shares * juniorNav) / totalJuniorShares;
        p.shares -= shares;
        totalJuniorShares -= shares;
        juniorNav -= value;
        if (!usdc.transfer(msg.sender, value)) revert TransferFailed();
        emit JuniorWithdrawn(msg.sender, shares, value);
    }

    // ---------- epoch settlement (the waterfall) ----------

    /// @notice Operator reports the epoch's house PnL. Profit: operator transfers `pnl` in.
    /// Loss: the tranche stack covers up to its full NAV and transfers the covered amount
    /// back to the operator (the trading vault). Scenario mapping per Playbook §2.6.
    function settleEpoch(int256 pnl) external onlyOperator notInsolvent {
        epochId += 1;
        uint256 seniorAccrual = 0;
        uint256 reserveDelta = 0;
        int256 juniorDelta = 0;

        if (pnl >= 0) {
            uint256 profit = uint256(pnl);
            if (profit > 0) {
                if (!usdc.transferFrom(msg.sender, address(this), profit)) revert TransferFailed();
                if (juniorRatioBps() < JUNIOR_MIN_RATIO_BPS) {
                    // dynamic yield curve: junior thin → ALL profit routes to junior
                    juniorNav += profit;
                    juniorDelta = int256(profit);
                } else {
                    uint256 target = (seniorNav * SENIOR_TARGET_APY_BPS) / 10_000 / 365; // daily prorate
                    seniorAccrual = profit < target ? profit : target;
                    uint256 rest = profit - seniorAccrual;
                    reserveDelta = (rest * RESERVE_CUT_BPS) / 10_000;
                    uint256 toJunior = rest - reserveDelta;
                    seniorNav += seniorAccrual;
                    yieldReserve += reserveDelta;
                    juniorNav += toJunior;
                    juniorDelta = int256(toJunior);
                }
            }
            // recovery check
            if (catastropheMode && seniorNav > 0 && juniorNav * 10_000 >= seniorNav * RECOVERY_RATIO_BPS) {
                catastropheMode = false;
                emit CatastropheExited(epochId);
            }
        } else {
            uint256 loss = uint256(-pnl);
            uint256 fromJunior = loss < juniorNav ? loss : juniorNav;
            juniorNav -= fromJunior;
            juniorDelta = -int256(fromJunior);
            uint256 remaining = loss - fromJunior;

            if (remaining > 0) {
                // junior is wiped: void its shares (new generation) and enter catastrophe
                if (totalJuniorShares > 0) {
                    juniorGen += 1;
                    totalJuniorShares = 0;
                    emit JuniorWiped(juniorGen);
                }
                if (!catastropheMode) {
                    catastropheMode = true;
                    emit CatastropheEntered(epochId);
                }
                uint256 fromReserve = remaining < yieldReserve ? remaining : yieldReserve;
                yieldReserve -= fromReserve;
                remaining -= fromReserve;

                uint256 fromSenior = remaining < seniorNav ? remaining : seniorNav;
                seniorNav -= fromSenior;
                remaining -= fromSenior;
            }

            uint256 covered = loss - remaining;
            if (covered > 0 && !usdc.transfer(msg.sender, covered)) revert TransferFailed();
            if (remaining > 0) {
                insolvent = true; // the stack is exhausted — halt everything, ops takes over
                emit InsolvencyDeclared(epochId, remaining);
            }
        }

        emit EpochSettled(epochId, pnl, seniorAccrual, juniorDelta, reserveDelta, catastropheMode);
    }

    modifier notInsolvent() {
        if (insolvent) revert Insolvent();
        _;
    }
}
