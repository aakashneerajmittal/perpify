// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {Operated} from "./Operated.sol";

/// @notice Price adapter behind a stable interface. TESTNET v0: operator-pushed index price
/// (clearly labeled source). M2 replaces the push path with Pyth pull + Chainlink check
/// WITHOUT changing this read interface — the rest of the system is source-agnostic.
contract OracleAdapter is Operated {
    enum Source {
        TestnetFeed,
        Pyth,
        Chainlink
    }

    struct PriceData {
        uint128 price1e8;
        uint64 postedAt;
        Source source;
    }

    PriceData public latest;
    uint256 public updateCount;

    event PricePosted(uint128 price1e8, Source source, uint64 postedAt);

    error BadPrice();
    error StalePrice();

    uint256 public constant MAX_STALENESS = 15 minutes; // TESTNET; session-aware staleness in M2

    constructor(address operator_) Operated(operator_) {}

    function postPrice(uint128 price1e8, Source source) external onlyOperator {
        if (price1e8 == 0) revert BadPrice();
        latest = PriceData(price1e8, uint64(block.timestamp), source);
        updateCount++;
        emit PricePosted(price1e8, source, uint64(block.timestamp));
    }

    /// @notice Read the latest price; reverts if stale so consumers fail closed.
    function latestPrice() external view returns (uint128 price1e8, uint64 postedAt, Source source) {
        PriceData memory p = latest;
        if (p.price1e8 == 0) revert BadPrice();
        if (block.timestamp > p.postedAt + MAX_STALENESS) revert StalePrice();
        return (p.price1e8, p.postedAt, p.source);
    }
}
