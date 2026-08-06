import { beforeEach, describe, expect, it } from "vitest";
import { apply, INSURANCE_ACCOUNT, insuranceFundBalance, replay } from "../src/core.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import { checkConservation, createEngine, stateRoot } from "../src/state.js";
import { checkBookInvariants } from "../src/book.js";
import type { Command } from "../src/types.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  bookOf,
  confidenceReading,
  deposit,
  findEvents,
  funding,
  gapReading,
  lcg,
  mkOrderCmd,
  nextNonce,
  posOf,
  resetIds,
  run,
  tick,
  tierUpdate,
  withdraw,
} from "./helpers.js";

beforeEach(() => resetIds());

function freshLog(): Command[] {
  return [];
}

describe("engine core: trading loop", () => {
  it("deposit → trade → positions on both sides, conservation holds", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 100_000));
    run(s, log, deposit(BOB, 100_000));

    const evs1 = run(s, log, mkOrderCmd(ALICE, "sell", 5000, 1));
    expect(findEvents(evs1, "OrderAccepted").length).toBe(1);
    expect(findEvents(evs1, "MarginCheck").length).toBe(1);

    const evs2 = run(s, log, mkOrderCmd(BOB, "buy", 5000, 1, { tif: "IOC" }));
    expect(findEvents(evs2, "TradeExecuted").length).toBe(1);

    expect(posOf(s, ALICE)?.side).toBe("sell");
    expect(posOf(s, BOB)?.side).toBe("buy");
    expect(posOf(s, ALICE)?.qty).toBe(qty8(1));

    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
    checkBookInvariants(bookOf(s));
  });

  it("tier A reserves less collateral than tier E for the identical order", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 100_000));
    run(s, log, deposit(CAROL, 100_000));
    run(s, log, tierUpdate(ALICE, "A", 0.85));
    run(s, log, tierUpdate(CAROL, "E", 1.3));

    const evA = run(s, log, mkOrderCmd(ALICE, "buy", 4990, 1));
    const evE = run(s, log, mkOrderCmd(CAROL, "buy", 4989, 1));
    const imA = findEvents(evA, "MarginCheck")[0]!.imRequired;
    const imE = findEvents(evE, "MarginCheck")[0]!.imRequired;
    expect(imA < imE).toBe(true);
    expect(Number(imE) / Number(imA)).toBeGreaterThan(1.5);
  });

  it("weekend gap reading raises margin for the same trader", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 100_000));

    const before = run(s, log, mkOrderCmd(ALICE, "buy", 4990, 1));
    run(s, log, gapReading(1.45, "weekend"));
    const after = run(s, log, mkOrderCmd(ALICE, "buy", 4991, 1));
    const im0 = findEvents(before, "MarginCheck")[0]!.imRequired;
    const im1 = findEvents(after, "MarginCheck")[0]!.imRequired;
    expect(Number(im1) / Number(im0)).toBeCloseTo(1.45, 1);
  });

  it("liquidation against the book: explainer emitted, penalty to insurance, conservation holds", () => {
    const s = createEngine(undefined, usd6(10_000));
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(BOB, 5_000));
    run(s, log, deposit(DAVE, 500_000));

    // bob longs 1 SPX at 5000 (≈3x); dave provides the exit bid deep below
    run(s, log, mkOrderCmd(DAVE, "sell", 5000, 1));
    run(s, log, mkOrderCmd(BOB, "buy", 5000, 1, { tif: "IOC" }));
    run(s, log, mkOrderCmd(DAVE, "buy", 3940, 5)); // resting bid that will absorb the liquidation

    const evs = run(s, log, tick(3950));
    const liq = findEvents(evs, "PositionLiquidated");
    expect(liq.length).toBe(1);
    expect(liq[0]!.explainer.owner).toBe(BOB);
    expect(liq[0]!.explainer.avgFillPx).toBe(px8(3940));
    expect(liq[0]!.explainer.queueRank).toBe(null);
    expect(posOf(s, BOB)).toBe(null);
    expect(insuranceFundBalance(s) > usd6(10_000)).toBe(true); // penalty collected

    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
  });

  it("empty-book liquidation: insurance fund inherits the position; conservation survives later mark moves", () => {
    const s = createEngine(undefined, usd6(50_000));
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 5_000));
    run(s, log, deposit(BOB, 500_000));

    run(s, log, mkOrderCmd(BOB, "sell", 5000, 1));
    run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC" }));

    // big gap with nobody quoting → backstop
    const evs = run(s, log, tick(3900));
    expect(findEvents(evs, "BackstopFill").length).toBe(1);
    expect(findEvents(evs, "PositionLiquidated").length).toBe(1);
    expect(posOf(s, INSURANCE_ACCOUNT)?.side).toBe("buy"); // fund inherited the long
    expect(posOf(s, INSURANCE_ACCOUNT)?.qty).toBe(qty8(1));

    // the law must keep holding as the mark moves — this is why the fund inherits
    for (const p of [3700, 3800, 4100]) {
      run(s, log, tick(p));
      const c = checkConservation(s);
      expect(c.holds, `at ${p}: drift=${c.driftAbs}`).toBe(true);
    }
  });

  it("gap beyond collateral → BadDebt covered by insurance, conservation holds", () => {
    const s = createEngine(undefined, usd6(50_000));
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 2_000));
    run(s, log, deposit(BOB, 500_000));
    run(s, log, mkOrderCmd(BOB, "sell", 5000, 1));
    run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC" }));

    const evs = run(s, log, tick(3000)); // -40% gap, loss $2000+ vs ~$1667 collateral
    expect(findEvents(evs, "BadDebt").length).toBeGreaterThan(0);
    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
  });

  it("cannot withdraw reserved collateral; can withdraw after cancel", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 10_000));
    run(s, log, mkOrderCmd(ALICE, "buy", 4900, 1, { id: "w1" }));

    const a = s.accounts.get(ALICE)!;
    const freeBefore = a.free;
    const evFail = run(s, log, withdraw(ALICE, 10_000));
    expect(findEvents(evFail, "CommandRejected").length).toBe(1);

    run(s, log, { kind: "CancelOrder", market: "SPX-PERP", orderId: "w1", owner: ALICE });
    expect(a.free).toBeGreaterThan(freeBefore);
    const evOk = run(s, log, withdraw(ALICE, 10_000));
    expect(findEvents(evOk, "WithdrawApplied").length).toBe(1);
    expect(checkConservation(s).holds).toBe(true);
  });

  it("venue reduce-only mode blocks new exposure but allows closes", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));
    run(s, log, deposit(BOB, 50_000));
    run(s, log, mkOrderCmd(ALICE, "sell", 5000, 1));
    run(s, log, mkOrderCmd(BOB, "buy", 5000, 1, { tif: "IOC" }));

    const evs = run(s, log, confidenceReading(0.4, true));
    expect(findEvents(evs, "ReduceOnlyChanged")[0]!.active).toBe(true);

    const evOpen = run(s, log, mkOrderCmd(CAROL, "buy", 5000, 1));
    expect(findEvents(evOpen, "OrderRejected")[0]!.reason).toContain("reduce-only");

    // bob closing his long is allowed (alice quotes the exit)
    run(s, log, confidenceReading(0.4, true));
    run(s, log, deposit(CAROL, 0.000001)); // no-op guard: keep log flowing
    const evClose = run(s, log, mkOrderCmd(BOB, "sell", 4999, 1, { tif: "IOC", reduceOnly: true }));
    // no resting bid → no fill, but the order must be ACCEPTED, not rejected
    expect(findEvents(evClose, "OrderRejected").length).toBe(0);
    expect(checkConservation(s).holds).toBe(true);
  });

  it("funding transfers between longs and shorts are zero-sum", () => {
    const s = createEngine();
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 100_000));
    run(s, log, deposit(BOB, 100_000));
    run(s, log, mkOrderCmd(ALICE, "sell", 5005, 1));
    run(s, log, mkOrderCmd(BOB, "buy", 5005, 1, { tif: "IOC" })); // trade above index → mark premium
    const evs = run(s, log, funding());
    const f = findEvents(evs, "FundingApplied")[0]!;
    expect(f.rateBps).toBeGreaterThan(0); // longs pay
    const c = checkConservation(s);
    expect(c.holds, `drift=${c.driftAbs}`).toBe(true);
  });
});

describe("determinism", () => {
  it("replaying the same command log reproduces state root and event chain exactly", () => {
    const s = createEngine(undefined, usd6(10_000));
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));
    run(s, log, deposit(BOB, 50_000));
    run(s, log, deposit(DAVE, 200_000));
    run(s, log, tierUpdate(ALICE, "A", 0.85));
    run(s, log, mkOrderCmd(DAVE, "sell", 5001, 2));
    run(s, log, mkOrderCmd(DAVE, "buy", 4999, 2));
    run(s, log, mkOrderCmd(ALICE, "buy", 5001, 1, { tif: "IOC" }));
    run(s, log, mkOrderCmd(BOB, "sell", 4999, 1.5, { tif: "IOC" }));
    run(s, log, gapReading(1.3));
    run(s, log, tick(4980));
    run(s, log, funding());
    run(s, log, tick(4750));
    run(s, log, { kind: "EpochClose", epochId: 1 });

    const s2 = replay(log, undefined, usd6(10_000));
    expect(stateRoot(s2)).toBe(stateRoot(s));
    expect(s2.eventHead).toBe(s.eventHead);
    expect(s2.eventCount).toBe(s.eventCount);
  });
});

describe("fuzz: conservation law under random command streams", () => {
  it("400 random commands, law holds after every single one; replay is identical", () => {
    const rng = lcg(20260716);
    const s = createEngine(undefined, usd6(100_000));
    const log: Command[] = [];
    const actors = [ALICE, BOB, CAROL, DAVE];
    let index = 5000;
    let oid = 0;

    run(s, log, tick(index));
    for (const a of actors) run(s, log, deposit(a, 250_000));

    for (let i = 0; i < 400; i++) {
      const r = rng();
      let cmd: Command;
      if (r < 0.38) {
        const owner = actors[Math.floor(rng() * actors.length)]!;
        const side = rng() < 0.5 ? "buy" : "sell";
        const price = Math.round(index * (0.985 + rng() * 0.03) * 100) / 100;
        const qty = Math.round((0.1 + rng() * 1.9) * 1e4) / 1e4;
        const tifRoll = rng();
        const tif = tifRoll < 0.5 ? "GTC" : tifRoll < 0.85 ? "IOC" : "POST_ONLY";
        const reduceOnly = tif === "IOC" && rng() < 0.25;
        cmd = mkOrderCmd(owner, side, price, qty, { tif, reduceOnly, id: `fz${oid++}` });
      } else if (r < 0.5) {
        const ids = [...bookOf(s).byId.keys()].sort();
        if (ids.length === 0) {
          cmd = tick(index);
        } else {
          const id = ids[Math.floor(rng() * ids.length)]!;
          const owner = bookOf(s).byId.get(id)!.owner;
          cmd = { kind: "CancelOrder", market: "SPX-PERP", orderId: id, owner };
        }
      } else if (r < 0.72) {
        const shock = rng() < 0.06 ? (rng() < 0.5 ? 0.93 : 1.07) : 0.995 + rng() * 0.01;
        index = Math.max(500, Math.round(index * shock * 100) / 100);
        cmd = tick(index);
      } else if (r < 0.82) {
        cmd = funding();
      } else if (r < 0.9) {
        cmd = deposit(actors[Math.floor(rng() * actors.length)]!, Math.round(rng() * 5000) + 1);
      } else if (r < 0.96) {
        cmd = withdraw(actors[Math.floor(rng() * actors.length)]!, Math.round(rng() * 3000) + 1);
      } else {
        cmd = rng() < 0.6 ? gapReading(1 + rng() * 0.8) : confidenceReading(0.3 + rng() * 0.7, rng() < 0.3);
      }

      run(s, log, cmd);

      const c = checkConservation(s);
      expect(c.holds, `cmd #${i} ${cmd.kind}: drift=${c.driftAbs} lhs=${c.lhs} rhs=${c.rhs}`).toBe(true);
      checkBookInvariants(bookOf(s));
      for (const [owner, acct] of s.accounts) {
        if (owner === INSURANCE_ACCOUNT) continue;
        expect(acct.free >= 0n, `negative free for ${owner} after #${i}`).toBe(true);
        expect(acct.reserved >= 0n, `negative reserved for ${owner} after #${i}`).toBe(true);
      }
    }

    const s2 = replay(log, undefined, usd6(100_000));
    expect(stateRoot(s2)).toBe(stateRoot(s));
    expect(s2.eventHead).toBe(s.eventHead);
  }, 30_000);
});

describe("behavioral capture (tier-v0.2.2): round-trips, MAE, revenge — end to end + replay-safe", () => {
  it("a losing round-trip records MAE, arms revenge, and the next oversized entry is flagged", () => {
    const s = createEngine(undefined, usd6(100_000));
    const log = freshLog();
    run(s, log, tick(5000));
    run(s, log, deposit(ALICE, 50_000));
    run(s, log, deposit(BOB, 500_000));

    // ALICE opens long 1 @ 5000 (BOB is the resting maker).
    run(s, log, mkOrderCmd(BOB, "sell", 5000, 1));
    run(s, log, mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC" }));
    expect(s.accounts.get(ALICE)!.behavior.trades).toBeGreaterThanOrEqual(1);
    expect(posOf(s, ALICE)!.worstAdverse6).toBe(0n);

    // price drops while the long is open → MAE accrues at the oracle mark.
    run(s, log, tick(4900));
    expect(posOf(s, ALICE)!.worstAdverse6).toBeGreaterThan(0n);

    // ALICE closes into BOB's bid at 4900 → realized loss → a losing round-trip is recorded.
    run(s, log, mkOrderCmd(BOB, "buy", 4900, 1));
    run(s, log, mkOrderCmd(ALICE, "sell", 4900, 1, { tif: "IOC", reduceOnly: true }));
    const closed = s.accounts.get(ALICE)!.behavior;
    expect(posOf(s, ALICE)).toBe(null);
    expect(closed.roundTrips).toBe(1);
    expect(closed.losers).toBe(1);
    expect(closed.sumMaeRatio6).toBeGreaterThan(0n); // the drawdown was captured into the round-trip
    expect(closed.lastLossNotional6).toBeGreaterThan(0n); // revenge is now armed

    // ALICE re-enters 5× larger right after the loss → revenge-sizing flagged, arm consumed.
    run(s, log, mkOrderCmd(BOB, "sell", 4900, 5));
    run(s, log, mkOrderCmd(ALICE, "buy", 4900, 5, { tif: "IOC" }));
    const revenged = s.accounts.get(ALICE)!.behavior;
    expect(revenged.revengeEvents).toBe(1);
    expect(revenged.lastLossNotional6).toBe(0n);

    // replay-safety: the whole behavioral state (MAE-derived ratios, revenge counts) reconstructs
    // byte-for-byte from the command log — same guarantee the venue's determinism rests on.
    const s2 = replay(log, undefined, usd6(100_000));
    expect(stateRoot(s2)).toBe(stateRoot(s));
    expect(s2.accounts.get(ALICE)!.behavior).toEqual(s.accounts.get(ALICE)!.behavior);
  });
});
