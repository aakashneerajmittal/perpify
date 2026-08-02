import { beforeEach, describe, expect, it } from "vitest";
import { apply } from "../src/core.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import { checkConservation, createEngine, type EngineState } from "../src/state.js";
import type { MarketId, Side, Tif } from "../src/types.js";
import { ALICE, BOB, findEvents, posOf, resetIds } from "./helpers.js";

beforeEach(() => resetIds());

let oid = 0;
const nonces = new Map<string, number>();
beforeEach(() => {
  oid = 0;
  nonces.clear();
});

function tickM(s: EngineState, market: MarketId, price: number) {
  return apply(s, { kind: "OracleTick", market, indexPx: px8(price), source: "testnet-feed" });
}
function dep(s: EngineState, owner: string, amt: number) {
  return apply(s, { kind: "Deposit", owner, amount: usd6(amt), l1TxHash: "0x" });
}
function order(
  s: EngineState,
  owner: string,
  market: MarketId,
  side: Side,
  price: number,
  qty: number,
  tif: Tif = "GTC",
  reduceOnly = false,
) {
  const n = (nonces.get(owner) ?? 0) + 1;
  nonces.set(owner, n);
  return apply(s, {
    kind: "PlaceOrder",
    order: { id: `o${++oid}`, market, owner, side, price: px8(price), qty: qty8(qty), tif, reduceOnly, nonce: n, expiry: 0, signature: "0x" },
  });
}

describe("multi-market venue", () => {
  it("one balance funds independent positions across different markets; conservation holds", () => {
    const s = createEngine(undefined, usd6(50_000));
    tickM(s, "NVDA-PERP", 180);
    tickM(s, "AAPL-PERP", 235);
    dep(s, ALICE, 200_000);
    dep(s, BOB, 2_000_000);

    // BOB quotes both markets; ALICE takes both from her single balance
    order(s, BOB, "NVDA-PERP", "sell", 180, 5);
    order(s, BOB, "AAPL-PERP", "sell", 235, 5);
    order(s, ALICE, "NVDA-PERP", "buy", 180, 5, "IOC");
    order(s, ALICE, "AAPL-PERP", "buy", 235, 5, "IOC");

    expect(posOf(s, ALICE, "NVDA-PERP")?.side).toBe("buy");
    expect(posOf(s, ALICE, "NVDA-PERP")?.qty).toBe(qty8(5));
    expect(posOf(s, ALICE, "AAPL-PERP")?.side).toBe("buy");
    expect(posOf(s, ALICE, "SPX-PERP")).toBe(null); // a market she never touched
    expect(s.accounts.get(ALICE)!.positions.size).toBe(2);
    expect(checkConservation(s).holds).toBe(true);
  });

  it("a crash in one market liquidates only that market's position; the other survives", () => {
    const s = createEngine(undefined, usd6(50_000));
    tickM(s, "NVDA-PERP", 180);
    tickM(s, "AAPL-PERP", 235);
    dep(s, ALICE, 200_000);
    dep(s, BOB, 2_000_000);

    order(s, BOB, "NVDA-PERP", "sell", 180, 5);
    order(s, BOB, "AAPL-PERP", "sell", 235, 5);
    order(s, ALICE, "NVDA-PERP", "buy", 180, 5, "IOC");
    order(s, ALICE, "AAPL-PERP", "buy", 235, 5, "IOC");

    // exit liquidity deep below on NVDA only, then crash NVDA ~30%
    order(s, BOB, "NVDA-PERP", "buy", 120, 30);
    const evs = tickM(s, "NVDA-PERP", 125);
    const liq = findEvents(evs, "PositionLiquidated");
    expect(liq.length).toBe(1);
    expect(liq[0]!.explainer.market).toBe("NVDA-PERP");
    expect(liq[0]!.explainer.owner).toBe(ALICE);

    expect(posOf(s, ALICE, "NVDA-PERP")).toBe(null); // liquidated
    expect(posOf(s, ALICE, "AAPL-PERP")?.side).toBe("buy"); // untouched — its mark never moved
    expect(checkConservation(s).holds).toBe(true);
  });

  it("gap coefficient is per-market: a weekend reading on one market doesn't move another's margin", () => {
    const s = createEngine(undefined, usd6(50_000));
    tickM(s, "NVDA-PERP", 180);
    tickM(s, "MSFT-PERP", 512);
    dep(s, ALICE, 500_000);
    dep(s, BOB, 5_000_000);
    order(s, BOB, "NVDA-PERP", "sell", 180, 2);
    order(s, BOB, "MSFT-PERP", "sell", 512, 2);

    // raise only NVDA's gap coefficient
    apply(s, {
      kind: "RiskReading",
      reading: { kind: "gap", market: "NVDA-PERP", gapCoefficient: 1.6, session: "weekend", hoursDark: 60, expectedGapStd: 0, modelVersion: "gap-v0.1-test", signature: "0x" },
    });

    const nvda = findEvents(order(s, ALICE, "NVDA-PERP", "buy", 180, 1, "IOC"), "MarginCheck")[0]!;
    const msft = findEvents(order(s, ALICE, "MSFT-PERP", "buy", 512, 1, "IOC"), "MarginCheck")[0]!;
    // NVDA priced the dark (gap 1.6); MSFT still at 1.0
    expect(nvda.inputs.gapCoefficient6).toBe((1_600_000).toString());
    expect(msft.inputs.gapCoefficient6).toBe((1_000_000).toString());
    expect(checkConservation(s).holds).toBe(true);
  });
});
