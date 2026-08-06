/**
 * Canonical shapes for the read-only connect.
 *
 * A `Fill` is one execution as the trader's venue reports it, normalized to a single vocabulary
 * (the same one the browser CSV path uses in trader-dna/app). Every exchange normalizer emits
 * `Fill[]`; the FIFO reconstruction (reconstruct.ts) walks them into `RoundTrip[]`, which is the
 * exact unit `trader-dna/train/features.py` scores. Keeping one Fill/RoundTrip vocabulary is what
 * lets a connected trader be scored by the *same* model — and the same round-trip signals
 * (hold time, R-multiple, disposition, revenge) the venue's own engine now captures on-chain.
 */

/** one normalized execution. side is +1 buy / -1 sell; qty is absolute; ts is epoch milliseconds. */
export interface Fill {
  ts: number; // epoch ms
  symbol: string; // normalized ticker (see normSymbol), e.g. "BTC", "AAPL"
  side: 1 | -1; // +1 buy, -1 sell
  qty: number; // absolute base quantity
  price: number; // execution price in quote/account ccy
  fee: number; // absolute fee in account ccy (>= 0)
  realizedPnl?: number | null; // exchange-reported realized PnL for this fill, when available
  assetClass?: "crypto" | "equity";
}

/**
 * A reconstructed round-trip — the unit features.py consumes. Core fields (t, symbol, side,
 * notional, pnl, hold, equity) are recovered from fills; the regime enrichment (vol_reg, grey,
 * mkt_ret) is attached by an injected market reference (see EnrichHooks) and defaults neutral so
 * the reconstruction stays pure and testable without bundled market data.
 */
export interface RoundTrip {
  ts: number; // entry time, epoch ms
  t: number; // entry time, days since the first round-trip (feature parity with training)
  symbol: string;
  side: 1 | -1; // +1 long entry, -1 short entry
  notional: number; // |entryPx * closeQty| in account ccy
  pnl: number; // realized PnL for this leg, net of attributed fees
  providedPnl: number | null; // exchange-reported realized PnL for the closing fill, if any
  hold: number; // holding period, days
  equity: number; // account equity at entry (set by setEquity; 0 until then)
  vol_reg: 0 | 1 | 2 | 3; // 0 calm, 1 normal, 2 elevated, 3 crisis (venue regime vocab)
  grey: boolean; // chop/untradeable tape at entry
  mkt_ret: number; // market return over the hold window (beta reference)
}

/** Injected market reference so reconstruction can stay pure. Defaults: normal regime, not grey,
 *  zero market return — the server wires in the same reference the browser app bundles. */
export interface EnrichHooks {
  regimeAt?: (ts: number) => { vol_reg: 0 | 1 | 2 | 3; grey: boolean };
  mktRetOverHold?: (ts: number, holdDays: number) => number;
}

export type Exchange = "binance" | "bybit" | "okx";
