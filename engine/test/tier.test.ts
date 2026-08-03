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
  ...o,
});
const RANK = ["A", "B", "C", "D", "E"];

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
