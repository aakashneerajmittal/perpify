import { describe, expect, it } from "vitest";
import { addOrder, bestAsk, bestBid, cancelOrder, checkBookInvariants, createBook } from "../src/book.js";
import { px8, qty8 } from "../src/fixed.js";
import type { Order, Side, Tif } from "../src/types.js";

let seqCounter = 0;
function o(owner: string, side: Side, price: number, qty: number, tif: Tif = "GTC", id?: string): Order {
  seqCounter++;
  return {
    id: id ?? `b${seqCounter}`,
    market: "SPX-PERP",
    owner,
    side,
    price: px8(price),
    qty: qty8(qty),
    remaining: qty8(qty),
    tif,
    reduceOnly: false,
    nonce: seqCounter,
    expiry: 0,
    signature: "0x",
    seq: seqCounter,
  };
}

describe("book: price-time priority", () => {
  it("fills better-priced level first, then FIFO within a level", () => {
    const b = createBook();
    addOrder(b, o("m1", "sell", 101, 1));
    addOrder(b, o("m2", "sell", 100, 1)); // better price, arrived later
    addOrder(b, o("m3", "sell", 100, 1)); // same price, after m2
    checkBookInvariants(b);

    const taker = o("t", "buy", 101, 2.5);
    const res = addOrder(b, taker);
    expect(res.fills.map((f) => f.maker)).toEqual(["m2", "m3", "m1"]); // price first, then time
    expect(res.fills[0]!.price).toBe(px8(100));
    expect(res.fills[2]!.price).toBe(px8(101));
    expect(res.fills[2]!.qty).toBe(qty8(0.5));
    checkBookInvariants(b);
  });

  it("rests GTC remainder at limit; book uncrossed", () => {
    const b = createBook();
    addOrder(b, o("m", "sell", 100, 1));
    const res = addOrder(b, o("t", "buy", 100, 3));
    expect(res.fills.length).toBe(1);
    expect(res.rested).toBe(true);
    expect(res.restedQty).toBe(qty8(2));
    expect(bestBid(b)).toBe(px8(100));
    expect(bestAsk(b)).toBe(null);
    checkBookInvariants(b);
  });

  it("IOC drops remainder", () => {
    const b = createBook();
    addOrder(b, o("m", "sell", 100, 1));
    const res = addOrder(b, o("t", "buy", 100, 3, "IOC"));
    expect(res.fills.length).toBe(1);
    expect(res.rested).toBe(false);
    expect(bestBid(b)).toBe(null);
    checkBookInvariants(b);
  });

  it("POST_ONLY rejects when it would cross, rests otherwise", () => {
    const b = createBook();
    addOrder(b, o("m", "sell", 100, 1));
    const crossing = addOrder(b, o("t", "buy", 100, 1, "POST_ONLY"));
    expect(crossing.postOnlyRejected).toBe(true);
    expect(crossing.fills.length).toBe(0);
    const passive = addOrder(b, o("t", "buy", 99, 1, "POST_ONLY"));
    expect(passive.rested).toBe(true);
    checkBookInvariants(b);
  });

  it("cancel removes the order and empties levels", () => {
    const b = createBook();
    addOrder(b, o("m", "sell", 100, 1, "GTC", "x1"));
    expect(cancelOrder(b, "x1")?.id).toBe("x1");
    expect(bestAsk(b)).toBe(null);
    expect(cancelOrder(b, "x1")).toBe(null);
    checkBookInvariants(b);
  });

  it("self-trade prevention cancels own resting order instead of matching", () => {
    const b = createBook();
    addOrder(b, o("same", "sell", 100, 1, "GTC", "own"));
    addOrder(b, o("other", "sell", 100, 1, "GTC", "oth"));
    const res = addOrder(b, o("same", "buy", 100, 1));
    expect(res.stpCanceled.map((c) => c.id)).toEqual(["own"]);
    expect(res.fills.map((f) => f.makerOrderId)).toEqual(["oth"]);
    checkBookInvariants(b);
  });

  it("qty is conserved through matching", () => {
    const b = createBook();
    addOrder(b, o("m1", "sell", 100, 1.2));
    addOrder(b, o("m2", "sell", 100.5, 0.8));
    const taker = o("t", "buy", 101, 1.5);
    const res = addOrder(b, taker);
    const filled = res.fills.reduce((a, f) => a + f.qty, 0n);
    expect(filled + taker.remaining).toBe(qty8(1.5));
    checkBookInvariants(b);
  });
});
