/**
 * RECONSTRUCTION — fills → round-trips via a FIFO signed-qty walk. Faithful TypeScript port of
 * `reconstruct` / `setEquity` in trader-dna/app (the browser CSV path), which itself mirrors the
 * position walk the venue uses. Robust to fills-only histories (no explicit open/close markers):
 * each reducing fill closes a round-trip against the oldest opposing lot. Enrichment (regime,
 * grey tape, market return) is injected so this stays pure and unit-testable without bundled
 * market data; it defaults to a neutral (normal-regime) reference.
 */
import type { EnrichHooks, Fill, RoundTrip } from "./types.js";

interface Lot {
  qty: number; // signed remaining
  qty0: number; // original |qty| (fee attribution base)
  price: number;
  ts: number;
  fee: number;
}

const DAY_MS = 86_400_000;
const NEUTRAL_REGIME = { vol_reg: 1 as const, grey: false };

/** Walk normalized fills into round-trips (chronological). Pure: does not mutate `fills`. */
export function reconstruct(fills: Fill[], hooks: EnrichHooks = {}): RoundTrip[] {
  const regimeAt = hooks.regimeAt ?? (() => NEUTRAL_REGIME);
  const mktRetOverHold = hooks.mktRetOverHold ?? (() => 0);

  const valid = fills
    .filter((f) => f && !isNaN(f.ts) && f.qty > 0 && isFinite(f.price) && f.price > 0)
    .sort((a, b) => a.ts - b.ts);

  const bySym = new Map<string, Fill[]>();
  for (const f of valid) {
    const arr = bySym.get(f.symbol);
    if (arr) arr.push(f);
    else bySym.set(f.symbol, [f]);
  }

  const rts: RoundTrip[] = [];
  for (const [sym, symFills] of bySym) {
    const lots: Lot[] = [];
    for (const f of symFills) {
      let signed = f.side * f.qty;
      const px = f.price;
      const feeRem = f.fee || 0;
      const fillQtyAbs = Math.abs(f.side * f.qty);

      // reduce opposing lots first (FIFO) — each closed portion is a round-trip
      while (signed !== 0 && lots.length > 0 && Math.sign(lots[0]!.qty) === -Math.sign(signed)) {
        const lot = lots[0]!;
        const closeQty = Math.min(Math.abs(signed), Math.abs(lot.qty));
        const entrySide = Math.sign(lot.qty) as 1 | -1;
        const entryPx = lot.price;
        const exitPx = px;
        const grossPnl = (exitPx - entryPx) * closeQty * entrySide;
        const notional = entryPx * closeQty;
        const holdDays = Math.max(0.01, (f.ts - lot.ts) / DAY_MS);
        // fee attribution: this fill's fee share for the closed qty + the entry lot's fee share
        const exitFeeShare = fillQtyAbs > 0 ? feeRem * (closeQty / fillQtyAbs) : 0;
        const entryFeeShare = lot.qty0 > 0 ? lot.fee * (closeQty / lot.qty0) : 0;
        const feeShare = exitFeeShare + entryFeeShare;
        const reg = regimeAt(lot.ts);
        rts.push({
          ts: lot.ts,
          t: 0, // filled in below (days since first round-trip)
          symbol: sym,
          side: entrySide,
          notional,
          pnl: grossPnl - (isFinite(feeShare) ? feeShare : 0),
          providedPnl: f.realizedPnl != null && isFinite(f.realizedPnl) ? f.realizedPnl : null,
          hold: holdDays,
          equity: 0,
          vol_reg: reg.vol_reg,
          grey: reg.grey,
          mkt_ret: mktRetOverHold(lot.ts, holdDays),
        });
        lot.qty += -entrySide * closeQty; // shrink the lot toward zero
        signed += -Math.sign(signed) * closeQty;
        if (Math.abs(lot.qty) < 1e-9) lots.shift();
      }

      // any residual opens (or extends into) a new lot
      if (signed !== 0) lots.push({ qty: signed, qty0: Math.abs(signed), price: px, ts: f.ts, fee: feeRem });
    }
  }

  rts.sort((a, b) => a.ts - b.ts);
  if (rts.length > 0) {
    const t0 = rts[0]!.ts;
    for (const r of rts) r.t = (r.ts - t0) / DAY_MS;
  }
  return rts;
}

/**
 * Attach account equity at each round-trip's entry — the highest-signal input for size fractions.
 * Uses the provided starting account value and drifts it by realized PnL, matching training (entry
 * equity), floored at 10% of the start so a blow-down can't make size fractions explode. Mutates
 * the round-trips in place (they're freshly produced by reconstruct).
 */
export function setEquity(rts: RoundTrip[], account0: number): void {
  let eq = account0;
  for (const r of rts) {
    r.equity = Math.max(0.1 * account0, eq);
    eq += r.pnl || 0;
  }
}
