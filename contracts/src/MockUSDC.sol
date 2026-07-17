// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @notice TESTNET ONLY: mintable 6-decimal USDC stand-in with a rate-limited faucet.
/// Mainnet uses canonical USDC on Base; this contract never ships beyond Sepolia.
contract MockUSDC {
    string public constant name = "Perpify Mock USDC";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastFaucetAt;

    uint256 public constant FAUCET_AMOUNT = 10_000e6; // $10k per drip
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();
    error FaucetCooldown();

    function faucet() external {
        if (block.timestamp < lastFaucetAt[msg.sender] + FAUCET_COOLDOWN) revert FaucetCooldown();
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice TESTNET convenience: open mint for seeding bots, PVault, and test fixtures.
    /// This token has zero value by construction; the allowlisted cohort makes griefing moot.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < value) revert InsufficientAllowance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        return _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        if (balanceOf[from] < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
