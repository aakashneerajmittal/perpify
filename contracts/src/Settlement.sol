// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {Operated} from "./Operated.sol";

interface IPerpVault {
    function payOut(address user, uint256 amount) external;
}

/// @notice Epoch settlement anchor. The engine closes a 24h epoch, computes the state root
/// and event-chain head (see engine/src/state.ts), and posts them here with the batch of
/// approved withdrawals. Anyone can later replay the engine's public command log and check
/// the posted roots — that is the venue's verifiability hook (upgrade path: validity proofs).
contract Settlement is Operated {
    IPerpVault public immutable vault;

    struct Epoch {
        bytes32 stateRoot;
        bytes32 eventChainHead;
        uint64 engineSeq;
        uint64 postedAt;
    }

    struct Payout {
        address user;
        uint256 amount;
    }

    uint64 public lastEpochId;
    mapping(uint64 => Epoch) public epochs;

    event EpochSettled(
        uint64 indexed epochId, bytes32 stateRoot, bytes32 eventChainHead, uint64 engineSeq, uint256 payoutCount
    );

    error NonSequentialEpoch(uint64 expected, uint64 got);
    error EmptyRoot();

    constructor(address operator_, address vault_) Operated(operator_) {
        vault = IPerpVault(vault_);
    }

    function settleEpoch(
        uint64 epochId,
        bytes32 stateRoot,
        bytes32 eventChainHead,
        uint64 engineSeq,
        Payout[] calldata payouts
    ) external onlyOperator {
        if (epochId != lastEpochId + 1) revert NonSequentialEpoch(lastEpochId + 1, epochId);
        if (stateRoot == bytes32(0) || eventChainHead == bytes32(0)) revert EmptyRoot();
        lastEpochId = epochId;
        epochs[epochId] =
            Epoch({stateRoot: stateRoot, eventChainHead: eventChainHead, engineSeq: engineSeq, postedAt: uint64(block.timestamp)});
        for (uint256 i = 0; i < payouts.length; i++) {
            vault.payOut(payouts[i].user, payouts[i].amount);
        }
        emit EpochSettled(epochId, stateRoot, eventChainHead, engineSeq, payouts.length);
    }
}
