import { beforeEach, describe, expect, it } from "vitest";
import { apply } from "../src/core.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import { checkConservation, createEngine, marketState, type EngineState } from "../src/state.js";
import type { MarketId, Side } from "../src/types.js";
import { ALICE, BOB, findEvents, posOf, resetIds } from "./helpers.js";

beforeEach(() => resetIds());
let oid = 0;
const nonces = new Map<string, number>();
beforeEach(() => {
  oid = 0;
  nonces.clear();
});

const tickM = (s: EngineState, m: MarketId, p: number) => apply(s, { kind: "OracleTick", market: m, indexPx: px8(p), source: "testnet-feed" });
const dep = (s: EngineState, o: string, a: number) => apply(s, { kind: "Deposit", owner: o, amount: usd6(a), l1TxHash: "0x" });
function order(s: EngineState, owner: string, market: MarketId, side: Side, price: number, qty: number, tif: "GTC" | "IOC" = "GTC", reduceOnly = false) {
  const n = (nonces.get(owner) ?? 0) + 1;
  nonces.set(owner, n);
  return apply(s, { kind: "PlaceOrder", order: { id: `o${++oid}`, market, owner, side, price: px8(price), qty: qty8(qty), tif, reduceOnly, nonce: n, expiry: 0, signature: "0x" } });
}
function trigger(s: EngineState, id: string, owner: string, market: MarketId, triggerPx: number, triggerAbove: boolean, side: Side, qty: number, reduceOnly = true, limitPx = 0) {
  return apply(s, { kind: "PlaceTrigger", trigger: { id, market, owner, triggerPx: px8(triggerPx), triggerAbove, side, qty: qty8(qty), limitPx: limitPx ? px8(limitPx) : 0n, reduceOnly, nonce: 0, expiry: 0, signature: "0x" } });
}

// set up: ALICE long 1 @ 5000; BOB rests a deep bid so a stop-sell can fill
function longWithExit(): EngineState {
  const s = createEngine(undefined, usd6(50_000));
  tickM(s, "SPX-PERP", 5000);
  dep(s, ALICE, 100_000);
  dep(s, BOB, 1_000_000);
  order(s, BOB, "SPX-PERP", "sell", 5000, 2);
  order(s, ALICE, "SPX-PERP", "buy", 5000, 1, "IOC");
  order(s, BOB, "SPX-PERP", "buy", 4800, 5); // exit liquidity for a stop
  order(s, BOB, "SPX-PERP", "sell", 5200, 5); // exit liquidity for a take-profit's counterparty
  return s;
}

describe("conditional (trigger) orders", () => {
  it("stop-loss arms, then fires on a downward cross and closes the position", () => {
    const s = longWithExit();
    const armEv = trigger(s, "sl1", ALICE, "SPX-PERP", 4850, false, "sell", 1, true);
    expect(findEvents(armEv, "TriggerArmed").length).toBe(1);
    expect(posOf(s, ALICE)?.qty).toBe(qty8(1));
    expect(marketState(s, "SPX-PERP").triggers.size).toBe(1);

    const ev = tickM(s, "SPX-PERP", 4840); // mark falls below 4850
    expect(findEvents(ev, "TriggerFired").length).toBe(1);
    expect(posOf(s, ALICE)).toBe(null); // stop closed the long
    expect(marketState(s, "SPX-PERP").triggers.size).toBe(0);
    expect(checkConservation(s).holds).toBe(true);
  });

  it("does not fire while the trigger price is not crossed", () => {
    const s = longWithExit();
    trigger(s, "sl2", ALICE, "SPX-PERP", 4850, false, "sell", 1, true);
    const ev = tickM(s, "SPX-PERP", 4900); // above the stop
    expect(findEvents(ev, "TriggerFired").length).toBe(0);
    expect(posOf(s, ALICE)?.qty).toBe(qty8(1));
  });

  it("cancel removes an armed trigger; it never fires", () => {
    const s = longWithExit();
    trigger(s, "sl3", ALICE, "SPX-PERP", 4850, false, "sell", 1, true);
    const cancelEv = apply(s, { kind: "CancelTrigger", market: "SPX-PERP", triggerId: "sl3", owner: ALICE });
    expect(findEvents(cancelEv, "TriggerCanceled").length).toBe(1);
    const ev = tickM(s, "SPX-PERP", 4840);
    expect(findEvents(ev, "TriggerFired").length).toBe(0);
    expect(posOf(s, ALICE)?.qty).toBe(qty8(1)); // untouched
  });

  it("take-profit fires on an upward cross", () => {
    const s = longWithExit();
    // TP: sell when mark >= 5150; BOB has a bid to absorb it
    order(s, BOB, "SPX-PERP", "buy", 5150, 5);
    trigger(s, "tp1", ALICE, "SPX-PERP", 5150, true, "sell", 1, true);
    const ev = tickM(s, "SPX-PERP", 5160);
    expect(findEvents(ev, "TriggerFired").length).toBe(1);
    expect(posOf(s, ALICE)).toBe(null);
    expect(checkConservation(s).holds).toBe(true);
  });

  it("a trigger already crossed at arm time fires immediately", () => {
    const s = longWithExit();
    // mark is 5000; arm a stop that is already crossed (fire when mark <= 5100)
    const ev = trigger(s, "sl4", ALICE, "SPX-PERP", 5100, false, "sell", 1, true);
    expect(findEvents(ev, "TriggerFired").length).toBe(1);
    expect(posOf(s, ALICE)).toBe(null);
    expect(checkConservation(s).holds).toBe(true);
  });
});
