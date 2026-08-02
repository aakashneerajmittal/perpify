import { apply } from "../src/core.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import { marketState, type EngineState } from "../src/state.js";
import type { Command, EngineEvent, MarketId, Order, Position, Side, Tif } from "../src/types.js";

/** a trader's position in one market (default SPX-PERP) — multi-market test accessor */
export const posOf = (s: EngineState, owner: string, market: MarketId = "SPX-PERP"): Position | null =>
  s.accounts.get(owner)?.positions.get(market) ?? null;

/** one market's order book (default SPX-PERP) */
export const bookOf = (s: EngineState, market: MarketId = "SPX-PERP") => marketState(s, market).book;

export const ALICE = "0xaaaa000000000000000000000000000000000001";
export const BOB = "0xbbbb000000000000000000000000000000000002";
export const CAROL = "0xcccc000000000000000000000000000000000003";
export const DAVE = "0xdddd000000000000000000000000000000000004";

let orderCounter = 0;
const nonces = new Map<string, number>();

export function resetIds(): void {
  orderCounter = 0;
  nonces.clear();
}

export function nextNonce(owner: string): number {
  const n = (nonces.get(owner) ?? 0) + 1;
  nonces.set(owner, n);
  return n;
}

export function mkOrderCmd(
  owner: string,
  side: Side,
  price: number,
  qty: number,
  opts: { tif?: Tif; reduceOnly?: boolean; id?: string } = {},
): Command {
  const order: Omit<Order, "remaining" | "seq"> = {
    id: opts.id ?? `o${++orderCounter}`,
    market: "SPX-PERP",
    owner,
    side,
    price: px8(price),
    qty: qty8(qty),
    tif: opts.tif ?? "GTC",
    reduceOnly: opts.reduceOnly ?? false,
    nonce: nextNonce(owner),
    expiry: 0,
    signature: "0xtest",
  };
  return { kind: "PlaceOrder", order };
}

export const deposit = (owner: string, amount: number): Command => ({
  kind: "Deposit",
  owner,
  amount: usd6(amount),
  l1TxHash: "0xdeadbeef",
});

export const withdraw = (owner: string, amount: number): Command => ({
  kind: "Withdraw",
  owner,
  amount: usd6(amount),
});

export const tick = (price: number): Command => ({
  kind: "OracleTick",
  market: "SPX-PERP",
  indexPx: px8(price),
  source: "testnet-feed",
});

export const funding = (): Command => ({ kind: "FundingTick", market: "SPX-PERP" });

export const gapReading = (coeff: number, session: "open" | "weeknight" | "weekend" = "weekend"): Command => ({
  kind: "RiskReading",
  reading: {
    kind: "gap",
    market: "SPX-PERP",
    gapCoefficient: coeff,
    session,
    hoursDark: session === "weekend" ? 40 : 10,
    expectedGapStd: 0.012,
    modelVersion: "gap-v0.1-test",
    signature: "0xtest",
  },
});

export const confidenceReading = (confidence: number, reduceOnly: boolean): Command => ({
  kind: "RiskReading",
  reading: {
    kind: "confidence",
    market: "SPX-PERP",
    confidence,
    dispersionBps: 3,
    stalenessMs: 200,
    reduceOnly,
    signature: "0xtest",
  },
});

export const tierUpdate = (wallet: string, tier: "A" | "B" | "C" | "D" | "E", tierMult: number): Command => ({
  kind: "TierUpdate",
  reading: {
    wallet,
    tier,
    tierMult,
    factors: [{ name: "test", contribution: 1 }],
    modelVersion: "tier-v0.1-test",
    signature: "0xtest",
  },
});

/** apply + collect events, with the command recorded into a log for replay tests */
export function run(s: EngineState, log: Command[], cmd: Command): EngineEvent[] {
  log.push(cmd);
  return apply(s, cmd);
}

export function findEvents<K extends EngineEvent["kind"]>(evs: EngineEvent[], kind: K): Extract<EngineEvent, { kind: K }>[] {
  return evs.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);
}

/** deterministic LCG for fuzz tests — engine itself never uses randomness */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(1103515245, x) + 12345) >>> 0;
    return x / 4294967296;
  };
}
