/**
 * REST compatibility layer (rest-v0.1).
 *
 * The Perpify frontend is a fork of a Binance-shaped exchange UI: besides the WebSocket streams
 * (which the engine already speaks), it fetches a handful of REST endpoints for 24h stats, the
 * chart's candle history, order-book depth, funding/premium, open interest and market sentiment.
 * The engine never implemented these, and its HTTP handler sent no CORS headers — so every one of
 * those calls was CORS-blocked, the header showed "--", the chart had no history, and the app
 * threw a stream of "cannot read properties of undefined" errors.
 *
 * This module answers those endpoints (with permissive CORS for the testnet) using live engine
 * state where it exists (mark/index/book/gap) and deterministic synthesis where the testnet has
 * no real history (24h stats, candles, sentiment) — clearly testnet data, never claimed as real.
 */
import type { EngineBus } from "./bus.js";
import { MARKET_IDS } from "../state.js";
import type { MarketId } from "../types.js";

const MARKET_SET = new Set<string>(MARKET_IDS);

export interface RestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface CorsCtx {
  origin?: string; // request Origin header
  reqHeaders?: string; // Access-Control-Request-Headers
}

/**
 * Build CORS headers. The frontend's axios sends withCredentials:true, so a wildcard
 * "*" origin is REJECTED by the browser — we must echo the exact request Origin and send
 * Access-Control-Allow-Credentials:true (and echo the requested headers, not "*").
 */
export function corsHeaders(ctx: CorsCtx): Record<string, string> {
  return {
    "access-control-allow-origin": ctx.origin || "*",
    "access-control-allow-credentials": "true",
    "vary": "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": ctx.reqHeaders || "Content-Type,Authorization",
    "access-control-max-age": "600",
  };
}

let CORS: Record<string, string> = corsHeaders({});

const json = (obj: unknown, status = 200): RestResponse => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  body: JSON.stringify(obj),
});

/** Map any client symbol/pair string to a known market (case-insensitive; default flagship). */
function resolveMarket(sym: string | null): MarketId {
  if (!sym) return "SPX-PERP";
  const up = sym.toUpperCase();
  if (MARKET_SET.has(up)) return up as MarketId;
  const withPerp = `${up}-PERP`;
  if (MARKET_SET.has(withPerp)) return withPerp as MarketId;
  return "SPX-PERP";
}

/** deterministic 0..1 hash of a string (stable synthetic data per symbol) */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0);
  return (h % 100000) / 100000;
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
  "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "8h": 28800000,
  "12h": 43200000, "1d": 86400000, "3d": 259200000, "1w": 604800000,
};

function markOf(bus: EngineBus, m: MarketId): number {
  const mkt = bus.state.markets.get(m);
  const px = mkt ? Number(mkt.markPx8) / 1e8 : 0;
  return px > 0 ? px : 0;
}
function indexOf(bus: EngineBus, m: MarketId): number {
  const mkt = bus.state.markets.get(m);
  const px = mkt ? Number(mkt.indexPx8) / 1e8 : 0;
  return px > 0 ? px : markOf(bus, m);
}

/** 24h stats synthesized deterministically per symbol around the live mark (testnet). */
function ticker24h(bus: EngineBus, m: MarketId, now: number) {
  const last = markOf(bus, m);
  const seed = hash01(m + "24h");
  const changePct = (seed - 0.5) * 4; // ±2%
  const open = last / (1 + changePct / 100);
  const high = Math.max(last, open) * (1 + (0.3 + seed) / 100);
  const low = Math.min(last, open) * (1 - (0.3 + (1 - seed)) / 100);
  const vol = Math.round((5000 + seed * 20000) * 100) / 100; // contracts
  return {
    symbol: m,
    priceChange: (last - open).toFixed(2),
    priceChangePercent: changePct.toFixed(2),
    weightedAvgPrice: ((high + low) / 2).toFixed(2),
    lastPrice: last.toFixed(2),
    lastQty: "1.0",
    openPrice: open.toFixed(2),
    highPrice: high.toFixed(2),
    lowPrice: low.toFixed(2),
    volume: vol.toFixed(2),
    quoteVolume: (vol * last).toFixed(2),
    openTime: now - 86400000,
    closeTime: now,
    firstId: 0,
    lastId: 0,
    count: Math.round(vol),
  };
}

/** backward-walk synthetic candles ending at `now`, anchored to the live mark. */
function klines(bus: EngineBus, m: MarketId, interval: string, limit: number, now: number) {
  const step = INTERVAL_MS[interval] ?? 60000;
  const n = Math.max(1, Math.min(1000, limit || 200));
  const last = markOf(bus, m) || 100;
  const out: (number | string)[][] = [];
  let close = last;
  let seed = Math.floor(hash01(m + interval) * 1e6) + 1;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // build newest→oldest, then reverse to oldest→newest (Binance order)
  for (let i = 0; i < n; i++) {
    const openTime = now - (i + 1) * step;
    const drift = (rnd() - 0.5) * last * 0.0015;
    const open = close - drift;
    const hi = Math.max(open, close) * (1 + rnd() * 0.0008);
    const lo = Math.min(open, close) * (1 - rnd() * 0.0008);
    const vol = (20 + rnd() * 120).toFixed(4);
    out.push([
      openTime,
      open.toFixed(2),
      hi.toFixed(2),
      lo.toFixed(2),
      close.toFixed(2),
      vol,
      openTime + step - 1,
      (Number(vol) * close).toFixed(2),
      Math.round(10 + rnd() * 60),
      (Number(vol) / 2).toFixed(4),
      (Number(vol) * close / 2).toFixed(2),
      "0",
    ]);
    close = open;
  }
  return out.reverse();
}

function depth(bus: EngineBus, m: MarketId, limit: number, now: number) {
  const mkt = bus.state.markets.get(m);
  const bids: [string, string][] = [];
  const asks: [string, string][] = [];
  if (mkt) {
    const takeBids = [...mkt.book.bids].sort((a, b) => Number(b.price - a.price)).slice(0, limit);
    const takeAsks = [...mkt.book.asks].sort((a, b) => Number(a.price - b.price)).slice(0, limit);
    const sumQ = (lvl: { queue: { remaining: bigint }[] }) => lvl.queue.reduce((s, o) => s + o.remaining, 0n);
    for (const l of takeBids) bids.push([(Number(l.price) / 1e8).toFixed(2), (Number(sumQ(l)) / 1e8).toFixed(4)]);
    for (const l of takeAsks) asks.push([(Number(l.price) / 1e8).toFixed(2), (Number(sumQ(l)) / 1e8).toFixed(4)]);
  }
  return { lastUpdateId: bus.state.seq, E: now, T: now, bids, asks };
}

/**
 * Answer a REST request. Returns a RestResponse for recognized paths (always with CORS), or null
 * to let the caller fall through to its default (health) handler.
 */
export function handleRest(bus: EngineBus, method: string, rawUrl: string, now: number, cors: CorsCtx = {}): RestResponse | null {
  // per-request CORS (echo the caller's origin + requested headers; credentials-safe).
  // Node runs this callback synchronously per request, so the shared var is safe here.
  CORS = corsHeaders(cors);
  if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
  const url = new URL(rawUrl, "http://localhost");
  const p = url.pathname.replace(/\/+$/, "");
  const q = url.searchParams;
  const sym = () => resolveMarket(q.get("symbol") || q.get("pair"));

  // chart candles
  if (p.endsWith("/fapi/v1/continuousKlines") || p.endsWith("/fapi/v1/klines") || p.endsWith("/fapi/v1/markPriceKlines") || p.endsWith("/fapi/v1/indexPriceKlines")) {
    return json(klines(bus, sym(), q.get("interval") || "1m", Number(q.get("limit")) || 200, now));
  }
  if (p.endsWith("/fapi/v1/ticker/24hr")) {
    if (q.get("symbol")) return json(ticker24h(bus, sym(), now));
    return json(MARKET_IDS.map((m) => ticker24h(bus, m, now)));
  }
  if (p.endsWith("/fapi/v1/ticker/price")) {
    const m = sym();
    return json({ symbol: m, price: markOf(bus, m).toFixed(2), time: now });
  }
  if (p.endsWith("/fapi/v1/premiumIndex")) {
    const m = sym();
    const rate = (hash01(m + "fund") - 0.5) * 0.0009; // ±0.045%
    return json({
      symbol: m,
      markPrice: markOf(bus, m).toFixed(2),
      indexPrice: indexOf(bus, m).toFixed(2),
      estimatedSettlePrice: markOf(bus, m).toFixed(2),
      lastFundingRate: rate.toFixed(8),
      interestRate: "0.00010000",
      nextFundingTime: (Math.floor(now / 3600000) + 1) * 3600000,
      time: now,
    });
  }
  if (p.endsWith("/fapi/v1/openInterest")) {
    const m = sym();
    const oi = (2000 + hash01(m + "oi") * 8000).toFixed(3);
    return json({ symbol: m, openInterest: oi, time: now });
  }
  if (p.endsWith("/fapi/v1/depth")) {
    return json(depth(bus, sym(), Number(q.get("limit")) || 20, now));
  }
  if (p.endsWith("/futures/data/topLongShortPositionRatio") || p.endsWith("/futures/data/topLongShortAccountRatio") || p.endsWith("/futures/data/globalLongShortAccountRatio")) {
    const m = sym();
    const longAcct = 0.45 + hash01(m + "ls") * 0.15; // 45–60% long
    const ratio = longAcct / (1 - longAcct);
    const period = q.get("period") || "5m";
    const step = INTERVAL_MS[period] ?? 300000;
    const rows = Array.from({ length: 30 }, (_, i) => ({
      symbol: m,
      longShortRatio: ratio.toFixed(4),
      longAccount: longAcct.toFixed(4),
      shortAccount: (1 - longAcct).toFixed(4),
      timestamp: now - (29 - i) * step,
    }));
    return json(rows);
  }
  if (p.endsWith("/fapi/v1/exchangeInfo")) {
    return json({
      timezone: "UTC",
      serverTime: now,
      symbols: MARKET_IDS.map((m) => ({
        symbol: m,
        pair: m,
        contractType: "PERPETUAL",
        status: "TRADING",
        baseAsset: m.replace("-PERP", ""),
        quoteAsset: "USDC",
        marginAsset: "USDC",
        pricePrecision: 2,
        quantityPrecision: 4,
        baseAssetPrecision: 8,
        quotePrecision: 8,
        filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.01", minPrice: "0.01", maxPrice: "1000000" },
          { filterType: "LOT_SIZE", stepSize: "0.0001", minQty: "0.0001", maxQty: "100000" },
          { filterType: "MIN_NOTIONAL", notional: "1" },
        ],
        orderTypes: ["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"],
        timeInForce: ["GTC", "IOC", "FOK"],
      })),
    });
  }
  // Density-custom symbol list (frontend already has the 6 markets from config; keep it happy).
  if (p.endsWith("/tradeable-symbol/24hour-ticker")) {
    return json(MARKET_IDS.map((m) => ticker24h(bus, m, now)));
  }
  if (p.endsWith("/tradeable-symbol")) {
    return json(MARKET_IDS.map((m) => ({ symbol: m, baseAsset: m.replace("-PERP", ""), quoteAsset: "USDC", status: "TRADING", pricePrecision: 2, quantityPrecision: 4 })));
  }
  if (p.endsWith("/fapi/v1/time")) return json({ serverTime: now });
  if (p.includes("/auth/session")) return json({ ok: true });

  return null; // not a REST route — let the caller serve its health response
}
