/**
 * Adversarial / hardening tests — the existential ones. The venue's whole promise is no insolvency
 * at reopen, so these probe the guarantees an attacker or a violent gap would try to break:
 * oracle-print manipulation, liquidation cascades, insurance depletion, reduce-only enforcement,
 * and self-trade (wash) farming of the behavioral tier. The invariant oracle is checkConservation:
 * deposits − withdrawals must equal cash + unrealized PnL, always.
 */
import { describe, expect, it } from "vitest";
import { INSURANCE_ACCOUNT, insuranceFundBalance } from "../src/core.js";
import { px8 } from "../src/fixed.js";
import { checkConservation, createEngine, marketState } from "../src/state.js";
import { ALICE, BOB, CAROL, DAVE, deposit, findEvents, mkOrderCmd, posOf, resetIds, run, tick } from "./helpers.js";

const mark = (s: any) => marketState(s, "SPX-PERP").markPx8;
const freshLog = () => [];

describe("oracle manipulation resistance", () => {
  it("a wild trade print can't hold the mark away from the index — the oracle snaps it back", () => {
    resetIds();
    const s = createEngine(undefined, 0n);
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));
    run(s, log, deposit(DAVE, 500_000));

    // a print 4% above index (a wash/thin-book print) moves the last-trade mark momentarily…
    run(s, log, mkOrderCmd(DAVE, "sell", 5200, 1));
    run(s, log, mkOrderCmd(ALICE, "buy", 5200, 1, { tif: "IOC" }));
    expect(mark(s)).toBe(px8(5200));

    // …but the next oracle tick re-snaps the mark inside the 0.5% band — a print can't strand it.
    run(s, log, tick(5000));
    expect(mark(s)).toBe(px8(5000));
    expect(checkConservation(s).holds).toBe(true);
  });
});

describe("liquidation cascade stays solvent", () => {
  it("multiple leveraged longs gap out together; all liquidate and conservation holds", () => {
    resetIds();
    const s = createEngine(undefined, 100_000n * 1_000_000n); // seed insurance
    const log = freshLog();
    run(s, log, tick(5000));
    for (const t of [ALICE, BOB, CAROL]) run(s, log, deposit(t, 3_000));
    run(s, log, deposit(DAVE, 5_000_000));

    // three ~3x longs at 5000
    for (const t of [ALICE, BOB, CAROL]) {
      run(s, log, mkOrderCmd(DAVE, "sell", 5000, 1));
      run(s, log, mkOrderCmd(t, "buy", 5000, 1, { tif: "IOC" }));
    }
    // a deep resting bid to absorb the forced sells, then a violent gap down
    run(s, log, mkOrderCmd(DAVE, "buy", 3800, 10));
    const evs = run(s, log, tick(3850));

    expect(findEvents(evs, "PositionLiquidated").length).toBeGreaterThanOrEqual(3);
    for (const t of [ALICE, BOB, CAROL]) expect(posOf(s, t)).toBe(null);
    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
  });
});

describe("insurance backstop accounting", () => {
  it("a gap beyond collateral is covered/flagged and conservation still holds", () => {
    resetIds();
    const s = createEngine(undefined, 50_000n * 1_000_000n);
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 2_000)); // thin margin
    run(s, log, deposit(DAVE, 5_000_000));
    run(s, log, mkOrderCmd(DAVE, "sell", 5000, 1));
    run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC" }));
    run(s, log, mkOrderCmd(DAVE, "buy", 2500, 10)); // far bid

    const before = insuranceFundBalance(s);
    const evs = run(s, log, tick(2600)); // ~48% gap, past ALICE's collateral
    expect(findEvents(evs, "PositionLiquidated").length).toBe(1);
    // the fund moved (covered the shortfall) and the books still balance to the penny-ish
    expect(insuranceFundBalance(s)).not.toBe(before);
    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
    // the insurance account is the only one allowed to run a deficit
    for (const [owner, a] of s.accounts) {
      if (owner === INSURANCE_ACCOUNT) continue;
      expect(a.free >= 0n, `negative free for ${owner}`).toBe(true);
    }
  });
});

describe("reduce-only mode blocks new risk", () => {
  it("rejects an opening order while the venue is defensive, but state stays clean", () => {
    resetIds();
    const s = createEngine(undefined, 0n);
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));
    // oracle confidence collapses → venue goes reduce-only
    run(s, log, {
      kind: "RiskReading",
      reading: { kind: "confidence", market: "SPX-PERP", confidence: 0.2, dispersionBps: 80, stalenessMs: 5000, reduceOnly: true, signature: "0xtest" },
    } as any);

    const evs = run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC" }));
    expect(findEvents(evs, "OrderRejected").some((e) => /reduce-only/i.test(e.reason))).toBe(true);
    expect(posOf(s, ALICE)).toBe(null);
    expect(checkConservation(s).holds).toBe(true);
  });
});

describe("no wash-trading the behavioral tier", () => {
  it("a self-cross is prevented — no self-fill, no position, no farmed trade count", () => {
    resetIds();
    const s = createEngine(undefined, 0n);
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));

    run(s, log, mkOrderCmd(ALICE, "sell", 5000, 1)); // rests
    const evs = run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1)); // would self-cross

    expect(findEvents(evs, "OrderCanceled").some((e) => e.reason === "self-trade-prevention")).toBe(true);
    expect(posOf(s, ALICE)).toBe(null);
    // the whole point: you can't inflate trades/volume to farm a better tier by trading yourself
    expect(s.accounts.get(ALICE)!.behavior.trades).toBe(0);
    expect(s.accounts.get(ALICE)!.behavior.volumeUsd6).toBe(0n);
  });
});
