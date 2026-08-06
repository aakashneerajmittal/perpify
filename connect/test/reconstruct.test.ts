import { describe, expect, it } from "vitest";
import { reconstruct, setEquity } from "../src/reconstruct.js";
import type { Fill } from "../src/types.js";

const DAY = 86_400_000;
const f = (ts: number, side: 1 | -1, qty: number, price: number, fee = 0, realizedPnl: number | null = null): Fill => ({
  ts,
  symbol: "BTC",
  side,
  qty,
  price,
  fee,
  realizedPnl,
});

describe("reconstruct: FIFO round-trips from fills", () => {
  it("a long round-trip: buy then sell higher = one winning round-trip", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(2 * DAY, -1, 1, 110)]);
    expect(rts.length).toBe(1);
    const r = rts[0]!;
    expect(r.side).toBe(1);
    expect(r.notional).toBe(100);
    expect(r.pnl).toBeCloseTo(10, 9);
    expect(r.hold).toBeCloseTo(2, 9);
    expect(r.t).toBe(0);
  });

  it("a short round-trip: sell then buy lower = winning", () => {
    const rts = reconstruct([f(0, -1, 1, 100), f(DAY, 1, 1, 90)]);
    expect(rts.length).toBe(1);
    expect(rts[0]!.side).toBe(-1);
    expect(rts[0]!.pnl).toBeCloseTo(10, 9);
  });

  it("a losing long round-trip has negative pnl", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 90)]);
    expect(rts[0]!.pnl).toBeCloseTo(-10, 9);
  });

  it("FIFO: one big entry, two partial exits → two round-trips against the same lot", () => {
    const rts = reconstruct([f(0, 1, 2, 100), f(DAY, -1, 1, 110), f(2 * DAY, -1, 1, 120)]);
    expect(rts.length).toBe(2);
    expect(rts[0]!.pnl).toBeCloseTo(10, 9); // close 1 @110
    expect(rts[1]!.pnl).toBeCloseTo(20, 9); // close 1 @120
    expect(rts.every((r) => r.notional === 100)).toBe(true);
  });

  it("fees reduce round-trip pnl (attributed from both entry and exit fills)", () => {
    const rts = reconstruct([f(0, 1, 1, 100, 1), f(DAY, -1, 1, 110, 2)]);
    expect(rts[0]!.pnl).toBeCloseTo(7, 9); // gross 10 − entry 1 − exit 2
  });

  it("disposition visible: winners short-held, losers long-held", () => {
    const rts = reconstruct([
      f(0, 1, 1, 100),
      f(0.5 * DAY, -1, 1, 110), // win, held 0.5d
      f(1 * DAY, 1, 1, 100),
      f(6 * DAY, -1, 1, 90), // loss, held 5d
    ]);
    const wins = rts.filter((r) => r.pnl > 0);
    const losses = rts.filter((r) => r.pnl < 0);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    expect(losses[0]!.hold).toBeGreaterThan(wins[0]!.hold);
  });

  it("nets per symbol independently", () => {
    const mk = (sym: string) => (ts: number, side: 1 | -1, qty: number, price: number): Fill => ({ ts, symbol: sym, side, qty, price, fee: 0, realizedPnl: null });
    const bt = mk("BTC");
    const et = mk("ETH");
    const rts = reconstruct([bt(0, 1, 1, 100), et(0, 1, 1, 50), bt(DAY, -1, 1, 110), et(DAY, -1, 1, 40)]);
    expect(rts.length).toBe(2);
    expect(rts.find((r) => r.symbol === "BTC")!.pnl).toBeCloseTo(10, 9);
    expect(rts.find((r) => r.symbol === "ETH")!.pnl).toBeCloseTo(-10, 9);
  });

  it("passes through exchange-provided realized PnL when present", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 110, 0, 9.5)]);
    expect(rts[0]!.providedPnl).toBe(9.5);
  });

  it("ignores malformed fills and does not mutate the input", () => {
    const bad = { ts: 500, symbol: "BTC", side: 1, qty: 0, price: -5, fee: 0, realizedPnl: null } as Fill; // qty 0 & neg price → filtered
    const input: Fill[] = [f(0, 1, 1, 100), bad, f(DAY, -1, 1, 110)];
    const copy = JSON.parse(JSON.stringify(input));
    const rts = reconstruct(input);
    expect(rts.length).toBe(1);
    expect(input).toEqual(copy); // input untouched
  });

  it("t is days-since-first across the whole history", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 110), f(3 * DAY, 1, 1, 100), f(4 * DAY, -1, 1, 90)]);
    expect(rts[0]!.t).toBe(0);
    expect(rts[1]!.t).toBeCloseTo(3, 9);
  });
});

describe("setEquity + enrichment", () => {
  it("drifts equity with realized pnl", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 110), f(2 * DAY, 1, 1, 100), f(3 * DAY, -1, 1, 90)]);
    setEquity(rts, 1000);
    expect(rts[0]!.equity).toBe(1000);
    expect(rts[1]!.equity).toBeCloseTo(1000 + rts[0]!.pnl, 9);
  });

  it("floors equity at 10% of the starting account", () => {
    // a big loss can't drive entry-equity below the floor (keeps size fractions sane)
    const rts = reconstruct([f(0, 1, 100, 100), f(DAY, -1, 100, 1), f(2 * DAY, 1, 1, 100), f(3 * DAY, -1, 1, 110)]);
    setEquity(rts, 1000);
    expect(rts[1]!.equity).toBe(100); // floored at 10% of 1000 despite the wipeout
  });

  it("enrichment hooks override the neutral default", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 110)], {
      regimeAt: () => ({ vol_reg: 3, grey: true }),
      mktRetOverHold: () => 0.05,
    });
    expect(rts[0]!.vol_reg).toBe(3);
    expect(rts[0]!.grey).toBe(true);
    expect(rts[0]!.mkt_ret).toBeCloseTo(0.05, 9);
  });

  it("defaults to a neutral regime with no hooks", () => {
    const rts = reconstruct([f(0, 1, 1, 100), f(DAY, -1, 1, 110)]);
    expect(rts[0]!.vol_reg).toBe(1);
    expect(rts[0]!.grey).toBe(false);
    expect(rts[0]!.mkt_ret).toBe(0);
  });
});
