import { describe, expect, it } from "vitest";
import { scoreTier } from "../src/risk/tierScore.js";
import { usd6 } from "../src/fixed.js";
import type { BehaviorStats } from "../src/types.js";

const W = "0xaaaa000000000000000000000000000000000abc";
const beh = (o: Partial<BehaviorStats> = {}): BehaviorStats => ({
  trades: 0,
  liquidations: 0,
  volumeUsd6: 0n,
  fundedUsd6: usd6(100_000),
  firstSeenSeq: 0,
  stressVolumeUsd6: 0n,
  stressTrades: 0,
  roundTrips: 0,
  winners: 0,
  losers: 0,
  sumWinHoldSeq: 0,
  sumLossHoldSeq: 0,
  sumRMultiple6: 0n,
  sumMaeRatio6: 0n,
  lastLossNotional6: 0n,
  revengeEvents: 0,
  revengeStressEvents: 0,
  ...o,
});
const RANK = ["A", "B", "C", "D", "E"];
const named = (r: { factors: { name: string }[] }, name: string) => r.factors.some((f) => f.name === name);

describe("tier-v0.2 behavioral scoring", () => {
  it("too little activity → provisional (address-derived) tier", () => {
    const r = scoreTier(W, beh({ trades: 1 }), 0n, 100);
    expect(r.modelVersion).toContain("provisional");
  });

  it("a liquidated, over-trading wallet scores worse than a clean, disciplined one", () => {
    const clean = scoreTier(W, beh({ trades: 20, volumeUsd6: usd6(300_000) }), usd6(600), 5000);
    const reckless = scoreTier(W, beh({ trades: 30, liquidations: 2, volumeUsd6: usd6(4_000_000) }), usd6(-5_000), 5000);
    expect(RANK.indexOf(reckless.tier)).toBeGreaterThan(RANK.indexOf(clean.tier));
    expect(reckless.modelVersion).toContain("live");
    expect(clean.modelVersion).toContain("live");
  });

  it("ships named, normalized factors", () => {
    const r = scoreTier(W, beh({ trades: 20, volumeUsd6: usd6(300_000) }), usd6(600), 5000);
    expect(r.factors.length).toBeGreaterThan(0);
    expect(r.factors[0]!.name).toBeTruthy();
    const sum = r.factors.reduce((s, f) => s + f.contribution, 0);
    expect(sum).toBeGreaterThan(0.9);
    expect(sum).toBeLessThan(1.1);
  });
});

describe("tier-v0.2.1 regime-conditioned scoring ('scored through the cycle')", () => {
  // Identical trader, identical turnover — the only difference is WHEN it happened. The wallet
  // that piled its size on while the venue was pricing elevated overnight/gap risk is the worse
  // risk, so it lands a worse tier and pays MORE margin for the exact same turnover.
  it("over-sizing into the dark period scores worse than the same turnover in calm markets", () => {
    const calm = scoreTier(W, beh({ trades: 30, volumeUsd6: usd6(1_000_000) }), 0n, 5000);
    const stress = scoreTier(
      W,
      beh({ trades: 30, volumeUsd6: usd6(1_000_000), stressVolumeUsd6: usd6(1_000_000), stressTrades: 30 }),
      0n,
      5000,
    );
    // worse tier, and the margin multiplier is strictly higher — the regime moved the money.
    expect(RANK.indexOf(stress.tier)).toBeGreaterThan(RANK.indexOf(calm.tier));
    expect(stress.tierMult).toBeGreaterThan(calm.tierMult);
    // and it's explainable — the penalty ships as a named factor, not an opaque score.
    expect(named(stress, "oversizing-into-stress")).toBe(true);
    expect(named(calm, "oversizing-into-stress")).toBe(false);
  });

  it("rewards a wallet that traded through stress with disciplined sizing", () => {
    const disciplined = scoreTier(
      W,
      beh({ trades: 20, volumeUsd6: usd6(300_000), stressVolumeUsd6: usd6(30_000), stressTrades: 5 }),
      0n,
      5000,
    );
    expect(named(disciplined, "disciplined-through-stress")).toBe(true);
    // stays in the trusted band (A or B), not dragged down for merely being present in stress.
    expect(RANK.indexOf(disciplined.tier)).toBeLessThanOrEqual(RANK.indexOf("B"));
  });

  it("regime scoring only kicks in above the activity floor (provisional stays address-derived)", () => {
    const cold = scoreTier(W, beh({ trades: 2, stressVolumeUsd6: usd6(5_000_000), stressTrades: 2 }), 0n, 5000);
    expect(cold.modelVersion).toContain("provisional");
    expect(named(cold, "oversizing-into-stress")).toBe(false);
  });
});

describe("tier-v0.2.2 round-trip & tilt features (R-multiple, MAE, disposition, revenge)", () => {
  // Shared clean baseline: 20 trades, modest turnover, tenure, no liquidations.
  const base = { trades: 20, volumeUsd6: usd6(300_000) as any };

  it("penalizes the disposition effect (holding losers longer than winners)", () => {
    // identical except loss-hold vs win-hold — winners and losers both count, only the asymmetry differs.
    const disciplined = scoreTier(
      W,
      beh({ ...base, roundTrips: 10, winners: 5, losers: 5, sumWinHoldSeq: 500, sumLossHoldSeq: 500 }),
      0n,
      5000,
    );
    const dispositional = scoreTier(
      W,
      beh({ ...base, roundTrips: 10, winners: 5, losers: 5, sumWinHoldSeq: 500, sumLossHoldSeq: 2500 }),
      0n,
      5000,
    );
    expect(RANK.indexOf(dispositional.tier)).toBeGreaterThan(RANK.indexOf(disciplined.tier));
    expect(dispositional.tierMult).toBeGreaterThan(disciplined.tierMult);
    expect(named(dispositional, "disposition-effect")).toBe(true);
    expect(named(disciplined, "cuts-losses-early")).toBe(true);
  });

  it("rewards favorable R-multiples and penalizes poor ones", () => {
    const goodR = scoreTier(W, beh({ ...base, roundTrips: 5, sumRMultiple6: usd6(5), sumMaeRatio6: usd6(0.5) }), 0n, 5000);
    const poorR = scoreTier(W, beh({ ...base, roundTrips: 5, sumRMultiple6: usd6(-5), sumMaeRatio6: usd6(0.5) }), 0n, 5000);
    expect(RANK.indexOf(goodR.tier)).toBeLessThan(RANK.indexOf(poorR.tier));
    expect(named(goodR, "positive-r-multiples")).toBe(true);
    expect(named(poorR, "poor-r-multiples")).toBe(true);
  });

  it("penalizes deep max-adverse-excursion vs tight risk control", () => {
    const deep = scoreTier(W, beh({ ...base, roundTrips: 5, sumMaeRatio6: usd6(4) }), 0n, 5000); // avg 0.8
    const tight = scoreTier(W, beh({ ...base, roundTrips: 5, sumMaeRatio6: usd6(0.5) }), 0n, 5000); // avg 0.1
    expect(RANK.indexOf(deep.tier)).toBeGreaterThan(RANK.indexOf(tight.tier));
    expect(named(deep, "deep-drawdowns")).toBe(true);
    expect(named(tight, "tight-risk-control")).toBe(true);
  });

  it("penalizes revenge-sizing, and extra when it happens into stress", () => {
    const clean = scoreTier(W, beh({ ...base }), 0n, 5000);
    const revenge = scoreTier(W, beh({ ...base, revengeEvents: 2 }), 0n, 5000);
    const revengeStress = scoreTier(W, beh({ ...base, revengeEvents: 2, revengeStressEvents: 1 }), 0n, 5000);
    expect(RANK.indexOf(revenge.tier)).toBeGreaterThan(RANK.indexOf(clean.tier));
    expect(RANK.indexOf(revengeStress.tier)).toBeGreaterThanOrEqual(RANK.indexOf(revenge.tier));
    expect(revengeStress.tierMult).toBeGreaterThan(revenge.tierMult);
    expect(named(revenge, "revenge-sizing")).toBe(true);
    expect(named(revengeStress, "revenge-into-stress")).toBe(true);
  });

  it("round-trip signals need a few closes; below the floor they don't fire", () => {
    const tooFew = scoreTier(W, beh({ ...base, roundTrips: 2, sumMaeRatio6: usd6(10) }), 0n, 5000);
    expect(named(tooFew, "deep-drawdowns")).toBe(false);
  });
});
