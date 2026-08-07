import { describe, expect, it } from "vitest";
import { backtestGapScenarios, positionRiskAt } from "./backtest.js";

describe("positionRiskAt (venue margin formula)", () => {
  it("computes IM/MM/leverage/liquidation at a baseline gap coefficient", () => {
    // DEFAULT_PARAMS: baseImBps 3333 (~0.3333), baseMmBps 1667 (~0.1667). Tier C mult 1.0.
    const r = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "buy", gapCoefficient: 1.0, tier: "C" });
    expect(r.initialMargin).toBeCloseTo(3333, 0);
    expect(r.maxLeverage).toBeCloseTo(3.0, 1);
    // qty = 2; drop = (IM−MM)/qty = (3333−1667)/2 ≈ 833 → long liq ≈ 4167
    expect(r.liquidationPrice).toBeCloseTo(4167, 0);
    expect(r.liqMovePct).toBeGreaterThan(0);
  });

  it("a higher gap coefficient posts more margin, lowers max leverage, and widens the liq buffer", () => {
    const calm = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "buy", gapCoefficient: 1.0, tier: "C" });
    const dark = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "buy", gapCoefficient: 1.3, tier: "C" });
    expect(dark.initialMargin).toBeGreaterThan(calm.initialMargin);
    expect(dark.maxLeverage).toBeLessThan(calm.maxLeverage);
    expect(dark.liqMovePct).toBeGreaterThan(calm.liqMovePct); // more posted margin → farther liquidation
  });

  it("a tier-A discount posts less margin than tier C for the same position", () => {
    const a = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "buy", gapCoefficient: 1.0, tier: "A" });
    const c = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "buy", gapCoefficient: 1.0, tier: "C" });
    expect(a.initialMargin).toBeLessThan(c.initialMargin);
  });

  it("short liquidation is above entry", () => {
    const s = positionRiskAt({ entryPx: 5000, notionalUsd: 10_000, side: "sell", gapCoefficient: 1.0, tier: "C" });
    expect(s.liquidationPrice).toBeGreaterThan(5000);
  });
});

describe("backtestGapScenarios (across the cycle)", () => {
  it("includes the live scenario plus a weekend-dark scenario per regime, worsening into crisis", () => {
    const rows = backtestGapScenarios({
      market: "SPX-PERP",
      entryPx: 5000,
      notionalUsd: 10_000,
      side: "buy",
      tier: "C",
      liveGapCoefficient: 1.0,
    });
    expect(rows[0]!.name).toContain("live");
    const names = rows.map((r) => r.name);
    expect(names.some((n) => /calm/.test(n))).toBe(true);
    expect(names.some((n) => /crisis/.test(n))).toBe(true);

    const live = rows[0]!;
    const crisis = rows.find((r) => /crisis/.test(r.name))!;
    expect(crisis.gapCoefficient).toBeGreaterThan(1.0);
    expect(crisis.initialMargin).toBeGreaterThan(live.initialMargin);
    expect(crisis.maxLeverage).toBeLessThan(live.maxLeverage);
  });

  it("omits the live scenario when no live coefficient is supplied", () => {
    const rows = backtestGapScenarios({ market: "SPX-PERP", entryPx: 5000, notionalUsd: 10_000, side: "buy", tier: "C" });
    expect(rows.every((r) => !/live/.test(r.name))).toBe(true);
    expect(rows.length).toBe(4); // four regimes
  });
});
