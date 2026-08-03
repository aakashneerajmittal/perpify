/**
 * Density wire protocol — pure mappers from engine state/events to the message shapes
 * the audited Density frontend already speaks (docs/density-reuse-map.md, harvest #1).
 *
 * Conventions (Binance-derived, matching the Density Go structs):
 *  - envelope: { eventType, orderID, eventData }
 *  - all numerics are STRINGS (prices/qty 8dp, USD 6dp) — lossless and UI-safe
 *  - positions: signed quantity (+ long / − short), positionSide "BOTH" (one-way V1)
 *  - orderType mapping v0: GTC/POST_ONLY → "LIMIT", IOC → "MARKET" (explicit types
 *    arrive with the intake API in M2)
 */
import type { Book } from "../book.js";
import { mmRequired, positionEquity, positionNotional, unrealizedPnl, type RiskCoeffs } from "../margin.js";
import type { Account, EngineParams, MarketId, Position, Trade } from "../types.js";

const f8 = (v: bigint): string => (Number(v) / 1e8).toFixed(8);
const f6 = (v: bigint): string => (Number(v) / 1e6).toFixed(6);

export interface WireMessage {
  eventType:
    | "ORDER_TRADE_UPDATE"
    | "ACCOUNT_UPDATE"
    | "ORDER_UPDATE"
    | "ACCOUNT_FROZE"
    | "LIQUIDATION_EXPLAINER"
    | "CONDITIONAL_ORDER_UPDATE";
  orderID?: string;
  eventData: unknown;
}

// ---------- ORDER_TRADE_UPDATE ----------

export interface OrderMeta {
  owner: string;
  market: MarketId; // which market this order/trade belongs to → the wire `s` symbol
  side: "buy" | "sell";
  tif: string;
  qty: bigint;
  filled: bigint;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  price?: bigint; // limit price (0 for pure-market IOC) — lets the UI show open-order price
}

export function toOrderTradeUpdate(orderId: string, meta: OrderMeta, fill: Trade | null, feeUsd6: bigint): WireMessage {
  const orderType = meta.tif === "IOC" ? "MARKET" : "LIMIT";
  const execType = meta.status === "NEW" ? "NEW" : meta.status === "CANCELED" ? "CANCELED" : fill ? "TRADE" : meta.status;
  const side = meta.side.toUpperCase();
  return {
    eventType: "ORDER_TRADE_UPDATE",
    orderID: orderId,
    eventData: {
      // Binance-style single-letter fields — the shape the Density frontend actually reads
      // (positionsHandler/checkFor* consume s, c, i, S, X, x, L, l, ot, p). `s` routes the
      // fill/position to the right market in the UI, so it must be the order's real symbol.
      s: meta.market, // symbol
      c: orderId, // client order id (the engine order id IS the client id for UI orders)
      i: orderId, // order id
      S: side, // BUY / SELL
      o: orderType, // order type
      ot: orderType, // original order type
      f: meta.tif, // time in force
      q: f8(meta.qty), // original qty
      p: meta.price !== undefined ? f8(meta.price) : "0.00000000", // order (limit) price
      ap: fill ? f8(fill.price) : "0.00000000", // average price
      sp: "0.00000000", // stop price
      x: execType, // execution type
      X: meta.status, // order status
      l: fill ? f8(fill.qty) : "0.00000000", // last filled qty
      z: f8(meta.filled), // cumulative filled qty
      L: fill ? f8(fill.price) : "0.00000000", // last filled price
      n: f6(feeUsd6), // commission
      N: "USDC", // commission asset
      T: fill ? fill.seq : 0, // engine sequence-time (deterministic venue clock)
      t: fill ? fill.id : "", // trade id
      m: fill ? fill.maker === meta.owner : false, // is maker
      rp: "0.000000", // realized pnl per fill lands with the intake API (M2)
      ps: "BOTH", // position side (one-way V1)
      // verbose aliases (kept for any consumer using long names)
      symbol: meta.market,
      brokerOrderID: orderId, // engine IS the venue: no external broker id
      side,
      orderType,
      timeInForce: meta.tif,
      status: meta.status,
      stopPrice: "0.00000000",
    },
  };
}

export function toOrderRejected(
  orderId: string,
  owner: string,
  reason: string,
  market: MarketId,
  meta?: Partial<OrderMeta>,
): WireMessage {
  return {
    eventType: "ORDER_UPDATE",
    orderID: orderId,
    eventData: {
      orderID: orderId,
      orderType: meta?.tif === "IOC" ? "MARKET" : "LIMIT",
      orderStatus: "REJECTED",
      statusRemarks: reason,
      orderQuantity: meta?.qty !== undefined ? f8(meta.qty) : "0.00000000",
      symbol: market,
      orderSide: (meta?.side ?? "buy").toUpperCase(),
    },
  };
}

// ---------- ACCOUNT_UPDATE ----------

export function toAccountUpdate(
  account: Account,
  markOf: (market: MarketId) => bigint,
  eventReason: string,
  balanceChange6: bigint,
): WireMessage {
  // one entry per open position, each valued at its own market's mark. Stable order
  // (sorted by symbol) so the stream is deterministic across runs.
  const positions = [...account.positions.values()]
    .sort((a, b) => (a.market < b.market ? -1 : a.market > b.market ? 1 : 0))
    .map((pos) => {
      const signedQty = pos.side === "buy" ? pos.qty : -pos.qty;
      return {
        symbol: pos.market,
        quantity: (Number(signedQty) / 1e8).toFixed(8),
        entryPrice: f8(pos.entryPx),
        accumulatedRealized: "0.000000", // per-position lifetime realized lands in M2 ledger views
        unrealizedProfitAndLoss: f6(unrealizedPnl(pos, markOf(pos.market))),
        marginType: "isolated",
        isolatedWallet: f6(pos.isolatedCollateral),
        positionSide: "BOTH",
      };
    });
  return {
    eventType: "ACCOUNT_UPDATE",
    orderID: "",
    eventData: {
      eventReason,
      // lifetime realized PnL across all closed positions (portfolio view)
      accumulatedRealized: f6(account.realizedPnl6),
      balances: [
        {
          asset: "USDC",
          walletBalance: f6(account.free),
          crossWalletBalance: f6(account.free), // V1 is isolated-only; cross == free
          balanceChange: f6(balanceChange6),
        },
      ],
      positions,
    },
  };
}

// ---------- order book (aggregated display shape) ----------

export interface BookWire {
  s: string; // symbol
  bp: string; // bid share of visible book, percent
  ap: string; // ask share of visible book, percent
  hp: number; // highest precision (max decimals supported)
  lp: number; // lowest precision
  l: number; // limit (levels per side)
  d: number; // decimals used for aggregation
  b: { P: string; Q: string; V: string; p: string }[]; // Price, Qty, cumulative Volume, % of max level
  a: { P: string; Q: string; V: string; p: string }[];
}

export function toBookWire(book: Book, symbol: MarketId, opts: { limit: number; decimal: number }): BookWire {
  const { limit, decimal } = opts;
  const scale = 10 ** decimal;

  const aggregate = (levels: { price: bigint; queue: { remaining: bigint }[] }[], isBid: boolean) => {
    const byBucket = new Map<number, bigint>();
    for (const lvl of levels) {
      const px = Number(lvl.price) / 1e8;
      const bucket = isBid ? Math.floor(px * scale) / scale : Math.ceil(px * scale) / scale;
      let qty = 0n;
      for (const o of lvl.queue) qty += o.remaining;
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0n) + qty);
    }
    const sorted = [...byBucket.entries()].sort((x, y) => (isBid ? y[0] - x[0] : x[0] - y[0])).slice(0, limit);
    let cum = 0n;
    let maxQ = 0n;
    for (const [, q] of sorted) if (q > maxQ) maxQ = q;
    return sorted.map(([P, Q]) => {
      cum += Q;
      return {
        P: P.toFixed(decimal),
        Q: (Number(Q) / 1e8).toFixed(8),
        V: (Number(cum) / 1e8).toFixed(8),
        p: maxQ > 0n ? ((Number(Q) / Number(maxQ)) * 100).toFixed(2) : "0.00",
      };
    });
  };

  const b = aggregate(book.bids, true);
  const a = aggregate(book.asks, false);
  const bidTotal = b.reduce((acc, x) => acc + Number(x.Q), 0);
  const askTotal = a.reduce((acc, x) => acc + Number(x.Q), 0);
  const total = bidTotal + askTotal;
  return {
    s: symbol,
    bp: total > 0 ? ((bidTotal / total) * 100).toFixed(2) : "50.00",
    ap: total > 0 ? ((askTotal / total) * 100).toFixed(2) : "50.00",
    hp: 8,
    lp: 0,
    l: limit,
    d: decimal,
    b,
    a,
  };
}

// ---------- position monitoring (500ms risk stream shape) ----------

export interface PositionMonitoringWire {
  symbol: string;
  marginMode: "isolated" | "cross";
  unRealizedPnL: string;
  maintenanceMargin: string;
  liquidationPrice: string;
  marginRatio: string;
}

/** isolated liquidation price closed form: equity(P) == MM(P)
 *  iso + (P − e)·q·dir = mmF·q·P  →  P = (e·q·dir − iso) / (q·(dir − mmF))
 *  mmF uses the CURRENT gap coefficient and tier — the liq price users see moves
 *  when the dark period reprices, exactly as the thesis intends. */
export function toPositionMonitoring(
  pos: Position,
  markPx8: bigint,
  params: EngineParams,
  coeffs: RiskCoeffs,
): PositionMonitoringWire {
  const mm = mmRequired(positionNotional(pos, markPx8), params, coeffs);
  const equity = positionEquity(pos, markPx8);
  const mmF =
    Math.max(
      (params.baseMmBps / 10_000) * (Number(coeffs.gapCoeff6) / 1e6) * (Number(coeffs.tierMult6) / 1e6),
      params.mmFloorBps / 10_000,
    );
  const dir = pos.side === "buy" ? 1 : -1;
  const e = Number(pos.entryPx) / 1e8;
  const q = Number(pos.qty) / 1e8;
  const iso = Number(pos.isolatedCollateral) / 1e6;
  const denom = q * (dir - mmF);
  const liqPx = denom !== 0 ? (e * q * dir - iso) / denom : 0;
  return {
    symbol: pos.market,
    marginMode: "isolated",
    unRealizedPnL: f6(unrealizedPnl(pos, markPx8)),
    maintenanceMargin: f6(mm),
    liquidationPrice: Math.max(0, liqPx).toFixed(2),
    marginRatio: equity > 0n ? (Number(mm) / Number(equity)).toFixed(4) : "9.9999",
  };
}
