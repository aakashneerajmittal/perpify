// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {Operated} from "./Operated.sol";

/// @notice On-chain home of the venue's risk state: gap coefficient, oracle confidence,
/// liquidation explainer hashes, and the model version registry. This is the anchor for
/// Playbook §2.4 (machine-readable risk state) — dashboards and agents read the same
/// values the engine actually used, and every liquidation's explainer hash lands here.
contract RiskRegistry is Operated {
    enum Session {
        Open,
        Weeknight,
        Weekend,
        Holiday
    }

    struct GapReading {
        uint64 coefficient1e6; // >= 1e6
        Session session;
        uint32 hoursDark10; // hours × 10 (one decimal)
        uint64 postedAt;
        string modelVersion;
    }

    struct ConfidenceReading {
        uint32 confidence1e6; // 0..1e6
        bool reduceOnly;
        uint64 postedAt;
    }

    GapReading public latestGap;
    ConfidenceReading public latestConfidence;

    uint256 public explainerCount;
    mapping(bytes32 => bool) public explainerPosted;
    mapping(string => bytes32) public modelArtifact; // "name@version" → artifact hash

    event GapPosted(uint64 coefficient1e6, Session session, uint32 hoursDark10, string modelVersion);
    event ConfidencePosted(uint32 confidence1e6, bool reduceOnly);
    event ExplainerPosted(bytes32 indexed inputsHash, address indexed wallet, uint64 engineSeq);
    event ModelRegistered(string key, bytes32 artifactHash);

    error BadCoefficient();
    error AlreadyPosted();

    constructor(address operator_) Operated(operator_) {}

    function postGapReading(uint64 coefficient1e6, Session session, uint32 hoursDark10, string calldata modelVersion)
        external
        onlyOperator
    {
        // sanity bounds: coefficient in [1.0, 10.0]
        if (coefficient1e6 < 1e6 || coefficient1e6 > 10e6) revert BadCoefficient();
        latestGap = GapReading(coefficient1e6, session, hoursDark10, uint64(block.timestamp), modelVersion);
        emit GapPosted(coefficient1e6, session, hoursDark10, modelVersion);
    }

    function postConfidence(uint32 confidence1e6, bool reduceOnly) external onlyOperator {
        latestConfidence = ConfidenceReading(confidence1e6, reduceOnly, uint64(block.timestamp));
        emit ConfidencePosted(confidence1e6, reduceOnly);
    }

    /// @notice One hash per liquidation: keccak/sha of the explainer inputs. Replaying the
    /// inputs through the named model version must reproduce the decision (Playbook §2.5).
    function postExplainer(bytes32 inputsHash, address wallet, uint64 engineSeq) external onlyOperator {
        if (explainerPosted[inputsHash]) revert AlreadyPosted();
        explainerPosted[inputsHash] = true;
        explainerCount++;
        emit ExplainerPosted(inputsHash, wallet, engineSeq);
    }

    function registerModel(string calldata key, bytes32 artifactHash) external onlyOperator {
        modelArtifact[key] = artifactHash;
        emit ModelRegistered(key, artifactHash);
    }
}
