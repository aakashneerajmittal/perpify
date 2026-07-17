// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {Operated} from "./Operated.sol";

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// @notice Custody vault for trading collateral. Users deposit USDC; per-account trading
/// balances are maintained by the off-chain engine (operator-trusted V1 — see trust model,
/// ARCHITECTURE.md §3); payouts (withdrawals, settlements) are executed only by authorized
/// contracts/keys, and every flow emits an event for the public reconciliation trail.
contract PerpVault is Operated {
    IERC20 public immutable usdc;

    /// @notice contracts allowed to pay out (Settlement) besides the operator
    mapping(address => bool) public authorized;

    uint256 public totalDeposited;
    uint256 public totalPaidOut;

    event Deposited(address indexed user, uint256 amount);
    event WithdrawRequested(address indexed user, uint256 amount);
    event PaidOut(address indexed user, uint256 amount, address indexed by);
    event AuthorizedSet(address indexed target, bool allowed);

    error NotAuthorized();
    error ZeroAmount();
    error TransferFailed();

    constructor(address operator_, address usdc_) Operated(operator_) {
        usdc = IERC20(usdc_);
    }

    function setAuthorized(address target, bool allowed) external onlyOperator {
        authorized[target] = allowed;
        emit AuthorizedSet(target, allowed);
    }

    /// @notice Deposit trading collateral. The engine credits the account when it sees
    /// the Deposited event (finality rules published in the methodology page).
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Signal a withdrawal. The engine validates free collateral off-chain and the
    /// next settlement batch executes the payout. TESTNET: no forced-exit path yet; the
    /// mainnet design adds a time-locked self-service exit if the operator stalls.
    function requestWithdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        emit WithdrawRequested(msg.sender, amount);
    }

    function payOut(address user, uint256 amount) external {
        if (msg.sender != operator && !authorized[msg.sender]) revert NotAuthorized();
        totalPaidOut += amount;
        if (!usdc.transfer(user, amount)) revert TransferFailed();
        emit PaidOut(user, amount, msg.sender);
    }
}
