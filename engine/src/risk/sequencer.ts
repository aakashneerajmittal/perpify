/**
 * Reopen sequencer planner (seq-v0.1).
 *
 * At a stressed reopen, dumping every liquidatable position into a thin book at once is what
 * turns a gap into a cascade. Instead we publish a deterministic clearing PLAN: score each
 * liquidatable position by a composite of behavioral tier (riskier clears first), contagion
 * (larger shortfall first) and depth (larger notional first), order them by queueRank, and
 * mark extreme/underwater-but-recoverable entries "defer". The ordering is a pure function of
 * its inputs → a published, replayable proof (Playbook §2.8 / §4.3). The engine can consume
 * this plan in reopen mode; here it also drives the March-2020 replay artifact.
 */
import { createHash } from "node:crypto";
import type { MarketId, SequencerPlan, SequencerPlanEntry, Px8 } from "../types.js";

export interface ReopenCandidate {
  owner: string;
  tierRank: number; // 0 = A (safest) … 4 = E (riskiest)
  shortfallUsd6: bigint; // equity below MM at the reopen price (>0 = liquidatable)
  notionalUsd6: bigint;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export function planReopen(
  market: MarketId,
  candidates: ReopenCandidate[],
  reopenLowPx: Px8,
  reopenHighPx: Px8,
): SequencerPlan {
  const totShort = candidates.reduce((s, c) => s + (c.shortfallUsd6 > 0n ? c.shortfallUsd6 : 0n), 0n) || 1n;
  const totNot = candidates.reduce((s, c) => s + c.notionalUsd6, 0n) || 1n;

  const scored = candidates
    .map((c) => {
      const scoreTier = c.tierRank / 4;
      const scoreContagion = Number(((c.shortfallUsd6 > 0n ? c.shortfallUsd6 : 0n) * 1000n) / totShort) / 1000;
      const scoreDepth = Number((c.notionalUsd6 * 1000n) / totNot) / 1000;
      const score = 0.5 * scoreTier + 0.3 * scoreContagion + 0.2 * scoreDepth;
      return { c, scoreTier, scoreContagion, scoreDepth, score };
    })
    .sort((a, b) => b.score - a.score);

  const entries: SequencerPlanEntry[] = scored.map((x, i) => ({
    owner: x.c.owner,
    scoreTier: round3(x.scoreTier),
    scoreContagion: round3(x.scoreContagion),
    scoreDepth: round3(x.scoreDepth),
    queueRank: i + 1,
    action: x.c.shortfallUsd6 > 0n ? "liquidate" : "defer",
  }));

  const publishedHash = "0x" + createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return {
    market,
    scenarioRange: { lowPx: reopenLowPx, highPx: reopenHighPx },
    entries,
    windowSeconds: 900,
    modelVersion: "seq-v0.1",
    publishedHash,
  };
}
