/**
 * Price-time CLOB for a single market. Pure data structure — no clocks, no I/O.
 *
 * Invariants (enforced in tests):
 *  - book never crossed: bestBid < bestAsk whenever both exist
 *  - within a level, FIFO by seq (time priority)
 *  - byId is exactly the set of resting orders
 */

import type { Order, Side } from "./types.js";

interface Level {
  price: bigint;
  queue: Order[]; // FIFO
}

export interface Book {
  bids: Level[]; // sorted descending by price
  asks: Level[]; // sorted ascending by price
  byId: Map<string, Order>;
}

export interface RawFill {
  price: bigint;
  qty: bigint;
  maker: string;
  makerOrderId: string;
}

export interface MatchOutcome {
  fills: RawFill[];
  /** resting orders canceled by self-trade prevention */
  stpCanceled: Order[];
  /** qty left on the taker after matching (rested if GTC, dropped if IOC) */
  restedQty: bigint;
  rested: boolean;
  /** true when POST_ONLY would have crossed → order rejected, nothing matched */
  postOnlyRejected: boolean;
}

export function createBook(): Book {
  return { bids: [], asks: [], byId: new Map() };
}

export function bestBid(b: Book): bigint | null {
  return b.bids.length ? b.bids[0]!.price : null;
}

export function bestAsk(b: Book): bigint | null {
  return b.asks.length ? b.asks[0]!.price : null;
}

function crosses(side: Side, price: bigint, oppBest: bigint | null): boolean {
  if (oppBest === null) return false;
  return side === "buy" ? price >= oppBest : price <= oppBest;
}

/** binary search insert position for a level */
function levelInsertIdx(levels: Level[], price: bigint, desc: boolean): number {
  let lo = 0;
  let hi = levels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = levels[mid]!.price;
    const before = desc ? p > price : p < price;
    if (before) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function restOrder(b: Book, o: Order): void {
  const desc = o.side === "buy";
  const levels = desc ? b.bids : b.asks;
  const idx = levelInsertIdx(levels, o.price, desc);
  const existing = levels[idx];
  if (existing && existing.price === o.price) {
    existing.queue.push(o);
  } else {
    levels.splice(idx, 0, { price: o.price, queue: [o] });
  }
  b.byId.set(o.id, o);
}

function removeLevelIfEmpty(levels: Level[], idx: number): void {
  if (levels[idx] && levels[idx]!.queue.length === 0) levels.splice(idx, 1);
}

/**
 * Match a taker order against the book.
 * Self-trade prevention: cancel-resting — the incoming order never trades with its
 * owner's own resting orders; those are canceled and reported.
 */
export function addOrder(b: Book, taker: Order): MatchOutcome {
  const out: MatchOutcome = { fills: [], stpCanceled: [], restedQty: 0n, rested: false, postOnlyRejected: false };
  const oppLevels = taker.side === "buy" ? b.asks : b.bids;

  if (taker.tif === "POST_ONLY") {
    const oppBest = taker.side === "buy" ? bestAsk(b) : bestBid(b);
    if (crosses(taker.side, taker.price, oppBest)) {
      out.postOnlyRejected = true;
      return out;
    }
  }

  while (taker.remaining > 0n && oppLevels.length > 0) {
    const level = oppLevels[0]!;
    if (!crosses(taker.side, taker.price, level.price)) break;

    const makerOrder = level.queue[0]!;
    if (makerOrder.owner === taker.owner) {
      // self-trade prevention: cancel resting
      level.queue.shift();
      b.byId.delete(makerOrder.id);
      out.stpCanceled.push(makerOrder);
      removeLevelIfEmpty(oppLevels, 0);
      continue;
    }

    const fillQty = taker.remaining < makerOrder.remaining ? taker.remaining : makerOrder.remaining;
    makerOrder.remaining -= fillQty;
    taker.remaining -= fillQty;
    out.fills.push({ price: level.price, qty: fillQty, maker: makerOrder.owner, makerOrderId: makerOrder.id });

    if (makerOrder.remaining === 0n) {
      level.queue.shift();
      b.byId.delete(makerOrder.id);
      removeLevelIfEmpty(oppLevels, 0);
    }
  }

  if (taker.remaining > 0n && taker.tif === "GTC") {
    restOrder(b, taker);
    out.restedQty = taker.remaining;
    out.rested = true;
  } else if (taker.remaining > 0n && taker.tif === "POST_ONLY") {
    // did not cross (checked above) → rests like GTC
    restOrder(b, taker);
    out.restedQty = taker.remaining;
    out.rested = true;
  }
  // IOC remainder is dropped

  return out;
}

export function cancelOrder(b: Book, orderId: string): Order | null {
  const o = b.byId.get(orderId);
  if (!o) return null;
  b.byId.delete(orderId);
  const levels = o.side === "buy" ? b.bids : b.asks;
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i]!;
    if (lvl.price === o.price) {
      const qi = lvl.queue.findIndex((q) => q.id === orderId);
      if (qi >= 0) lvl.queue.splice(qi, 1);
      removeLevelIfEmpty(levels, i);
      break;
    }
  }
  return o;
}

/** all resting orders of one owner (used when liquidating: pull their quotes first) */
export function ordersOf(b: Book, owner: string): Order[] {
  const res: Order[] = [];
  for (const o of b.byId.values()) if (o.owner === owner) res.push(o);
  // deterministic order: by seq
  res.sort((x, y) => x.seq - y.seq);
  return res;
}

/** test helper: verify structural invariants */
export function checkBookInvariants(b: Book): void {
  const bb = bestBid(b);
  const ba = bestAsk(b);
  if (bb !== null && ba !== null && bb >= ba) throw new Error(`crossed book: bid ${bb} >= ask ${ba}`);
  for (let i = 1; i < b.bids.length; i++) {
    if (b.bids[i]!.price >= b.bids[i - 1]!.price) throw new Error("bids not strictly descending");
  }
  for (let i = 1; i < b.asks.length; i++) {
    if (b.asks[i]!.price <= b.asks[i - 1]!.price) throw new Error("asks not strictly ascending");
  }
  let count = 0;
  for (const levels of [b.bids, b.asks]) {
    for (const lvl of levels) {
      let prevSeq = -1;
      for (const o of lvl.queue) {
        if (o.remaining <= 0n) throw new Error("resting order with zero remaining");
        if (o.seq <= prevSeq) throw new Error("FIFO violated within level");
        prevSeq = o.seq;
        if (!b.byId.has(o.id)) throw new Error("resting order missing from byId");
        count++;
      }
    }
  }
  if (count !== b.byId.size) throw new Error("byId size mismatch");
}
