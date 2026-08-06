/**
 * Exchange trade-history normalizers — map each venue's account-trade API response into the
 * canonical `Fill` vocabulary. Pure functions of already-fetched JSON (no network, no secrets):
 * the live signed fetch is a separate, thinner layer (next chunk) that hands its response here.
 *
 * Targets the documented response shapes:
 *   Binance USDⓈ-M futures  GET /fapi/v1/userTrades      → bare array of trades
 *   Bybit v5               GET /v5/execution/list        → { result: { list: [...] } }
 *   OKX v5                 GET /api/v5/trade/fills        → { data: [...] }
 *
 * Symbol normalization mirrors trader-dna/app's `norm` so a connected trader and a CSV upload key
 * the same instrument identically (and net long/short correctly within it).
 */
import type { Exchange, Fill } from "./types.js";

/** normalize a raw ticker to the app's convention: upper, strip one trailing quote/PERP/SWAP tag,
 *  drop non-alphanumerics. e.g. "BTC-USDT"→"BTC", "BTC-USDT-SWAP"→"BTCUSDT", "AAPL"→"AAPL". */
export function normSymbol(sym: unknown): string {
  if (sym == null) return "?";
  return (
    String(sym)
      .toUpperCase()
      .replace(/[-_]?(PERP|USDT|USDC|USD|SWAP|\.P)$/i, "")
      .replace(/[^A-Z0-9]/g, "") || "?"
  );
}

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : parseFloat(String(x));
  return isFinite(n) ? n : NaN;
};

const isBuy = (side: unknown): boolean => /^b|buy|long/i.test(String(side ?? ""));

/** pull the trades array out of a bare array or a known wrapper path. */
function rowsFrom(raw: unknown, ...paths: string[][]): any[] {
  if (Array.isArray(raw)) return raw;
  const r = raw as any;
  for (const path of paths) {
    let cur: any = r;
    for (const key of path) cur = cur?.[key];
    if (Array.isArray(cur)) return cur;
  }
  return [];
}

/** Binance USDⓈ-M futures userTrades. */
export function normalizeBinance(raw: unknown): Fill[] {
  return rowsFrom(raw, ["rows"], ["data"])
    .map((t: any): Fill => ({
      ts: num(t.time),
      symbol: normSymbol(t.symbol),
      side: isBuy(t.side) ? 1 : -1,
      qty: Math.abs(num(t.qty)),
      price: num(t.price),
      fee: Math.abs(num(t.commission)) || 0,
      realizedPnl: t.realizedPnl != null && isFinite(num(t.realizedPnl)) ? num(t.realizedPnl) : null,
      assetClass: "crypto",
    }))
    .filter(validFill);
}

/** Bybit v5 execution/list. */
export function normalizeBybit(raw: unknown): Fill[] {
  return rowsFrom(raw, ["result", "list"], ["list"])
    .map((t: any): Fill => ({
      ts: num(t.execTime),
      symbol: normSymbol(t.symbol),
      side: isBuy(t.side) ? 1 : -1,
      qty: Math.abs(num(t.execQty)),
      price: num(t.execPrice),
      fee: Math.abs(num(t.execFee)) || 0,
      realizedPnl: t.closedPnl != null && isFinite(num(t.closedPnl)) ? num(t.closedPnl) : null,
      assetClass: "crypto",
    }))
    .filter(validFill);
}

/** OKX v5 trade/fills. OKX reports fee as negative when charged; we store the absolute cost. */
export function normalizeOkx(raw: unknown): Fill[] {
  return rowsFrom(raw, ["data"])
    .map((t: any): Fill => ({
      ts: num(t.ts),
      symbol: normSymbol(t.instId),
      side: isBuy(t.side) ? 1 : -1,
      qty: Math.abs(num(t.fillSz)),
      price: num(t.fillPx),
      fee: Math.abs(num(t.fee)) || 0,
      realizedPnl: t.fillPnl != null && isFinite(num(t.fillPnl)) ? num(t.fillPnl) : null,
      assetClass: "crypto",
    }))
    .filter(validFill);
}

/** a fill the reconstruction can use — finite timestamp, positive qty and price. */
function validFill(f: Fill): boolean {
  return isFinite(f.ts) && f.qty > 0 && isFinite(f.price) && f.price > 0;
}

const NORMALIZERS: Record<Exchange, (raw: unknown) => Fill[]> = {
  binance: normalizeBinance,
  bybit: normalizeBybit,
  okx: normalizeOkx,
};

/** dispatch to the right normalizer by exchange id. */
export function normalize(exchange: Exchange, raw: unknown): Fill[] {
  const fn = NORMALIZERS[exchange];
  if (!fn) throw new Error(`unknown exchange: ${exchange}`);
  return fn(raw);
}
