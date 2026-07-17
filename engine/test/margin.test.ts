import { describe, expect, it } from "vitest";
import { px8, qty8, toCoeff6, usd6 } from "../src/fixed.js";
import { collateralRequired, imRequired, mmRequired, positionEquity, unrealizedPnl } from "../src/margin.js";
import { DEFAULT_PARAMS } from "../src/state.js";
import type { Position } from "../src/types.js";

const P = DEFAULT_PARAMS;
const N = usd6(10_000); // $10k notional

describe("margin math: the product-truth checks", () => {
  it("tier A pays less margin than tier E for the same position", () => {
    const a = imRequired(N, P, { gapCoeff6: toCoeff6(1.0), tierMult6: toCoeff6(0.85), tier: "A" });
    const e = imRequired(N, P, { gapCoeff6: toCoeff6(1.0), tierMult6: toCoeff6(1.3), tier: "E" });
    expect(a < e).toBe(true);
    // E pays ~53% more than A (1.3 / 0.85)
    expect(Number(e) / Number(a)).toBeCloseTo(1.3 / 0.85, 2);
  });

  it("weekend gap coefficient raises margin on the same position", () => {
    const tue = imRequired(N, P, { gapCoeff6: toCoeff6(1.0), tierMult6: toCoeff6(1.0), tier: "C" });
    const fri = imRequired(N, P, { gapCoeff6: toCoeff6(1.4), tierMult6: toCoeff6(1.0), tier: "C" });
    expect(Number(fri) / Number(tue)).toBeCloseTo(1.4, 3);
  });

  it("MM never drops below the floor, even for the best tier", () => {
    const tiny = mmRequired(N, P, { gapCoeff6: toCoeff6(1.0), tierMult6: toCoeff6(0.01), tier: "A" });
    expect(tiny).toBe(usd6(100)); // 1% floor of $10k
  });

  it("leverage cap binds when IM would allow more leverage than the tier permits", () => {
    // tier A: mult 0.85 → IM ≈ 28.3% of notional (≈3.5x), but maxLev A = 4 → byLev = 25%
    // IM larger → IM binds. For a hypothetical low IM param it flips; both paths covered:
    const c = { gapCoeff6: toCoeff6(1.0), tierMult6: toCoeff6(0.85), tier: "A" as const };
    const req = collateralRequired(N, P, c);
    expect(req).toBe(imRequired(N, P, c)); // IM binds here
    const lowIm = { ...P, baseImBps: 1000 }; // 10% IM → 10x, but tier A caps at 4x → 25% binds
    expect(collateralRequired(N, lowIm, c)).toBe(N / 4n);
  });

  it("unrealized PnL sign and equity", () => {
    const long: Position = {
      market: "SPX-PERP",
      owner: "0xa",
      side: "buy",
      qty: qty8(2),
      entryPx: px8(5000),
      isolatedCollateral: usd6(3000),
      openedSeq: 1,
    };
    expect(unrealizedPnl(long, px8(5100))).toBe(usd6(200)); // +100 × 2
    expect(unrealizedPnl(long, px8(4900))).toBe(usd6(-200));
    expect(positionEquity(long, px8(4900))).toBe(usd6(2800));
    const short: Position = { ...long, side: "sell" };
    expect(unrealizedPnl(short, px8(4900))).toBe(usd6(200));
  });
});
