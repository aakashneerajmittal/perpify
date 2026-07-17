// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @notice Minimal operator-access base. TESTNET: single operator EOA; mainnet replaces
/// this with a multisig + timelock (see ARCHITECTURE.md §3 trust model).
abstract contract Operated {
    address public operator;

    event OperatorTransferred(address indexed from, address indexed to);

    error NotOperator();
    error ZeroAddress();

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function transferOperator(address to) external onlyOperator {
        if (to == address(0)) revert ZeroAddress();
        emit OperatorTransferred(operator, to);
        operator = to;
    }
}
