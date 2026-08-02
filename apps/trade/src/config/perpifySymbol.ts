/**
 * Perpify market registry — the "exchange info" the app normally fetches from an API,
 * for every market the venue runs. Injected into the tradablesymbolList redux slice by
 * usePerpifyMarketData so every precision/tick/step-driven component (header price, order
 * book rows, order form, positions) populates for whichever symbol is selected.
 *
 * Markets: the S&P 500 index perp (flagship) + the five largest US companies by market cap
 * as single-stock perps. Binance-futures exchangeInfo shape (what SymbolPrecisionHelper and
 * the order form read).
 */
export interface PerpifyMarketMeta {
  symbol: string; // "NVDA-PERP"
  base: string; // "NVDA"
  name: string; // "NVIDIA"
  kind: "index" | "stock";
  pricePrecision: number;
  quantityPrecision: number;
}

export const PERPIFY_MARKETS: PerpifyMarketMeta[] = [
  { symbol: "SPX-PERP", base: "SPX", name: "S&P 500 Index", kind: "index", pricePrecision: 2, quantityPrecision: 4 },
  { symbol: "NVDA-PERP", base: "NVDA", name: "NVIDIA", kind: "stock", pricePrecision: 2, quantityPrecision: 4 },
  { symbol: "AAPL-PERP", base: "AAPL", name: "Apple", kind: "stock", pricePrecision: 2, quantityPrecision: 4 },
  { symbol: "MSFT-PERP", base: "MSFT", name: "Microsoft", kind: "stock", pricePrecision: 2, quantityPrecision: 4 },
  { symbol: "GOOGL-PERP", base: "GOOGL", name: "Alphabet", kind: "stock", pricePrecision: 2, quantityPrecision: 4 },
  { symbol: "AMZN-PERP", base: "AMZN", name: "Amazon", kind: "stock", pricePrecision: 2, quantityPrecision: 4 },
];

/** quick lookup: symbol → display metadata */
export const PERPIFY_MARKET_BY_SYMBOL: Record<string, PerpifyMarketMeta> = Object.fromEntries(
  PERPIFY_MARKETS.map((m) => [m.symbol, m]),
);

/** Binance-futures exchangeInfo for one market (the shape the precision helper + order form read) */
export function exchangeInfoFor(m: PerpifyMarketMeta) {
  return {
    symbol: m.symbol,
    pair: m.symbol,
    contractType: "PERPETUAL",
    status: "TRADING",
    baseAsset: m.base,
    quoteAsset: "USDC",
    marginAsset: "USDC",
    pricePrecision: m.pricePrecision,
    quantityPrecision: m.quantityPrecision,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: m.kind === "index" ? "INDEX" : "STOCK",
    orderTypes: ["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"],
    timeInForce: ["GTC", "IOC", "FOK"],
    filters: [
      { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "10000000", tickSize: "0.01" },
      { filterType: "LOT_SIZE", minQty: "0.0001", maxQty: "100000", stepSize: "0.0001" },
      { filterType: "MARKET_LOT_SIZE", minQty: "0.0001", maxQty: "100000", stepSize: "0.0001" },
      { filterType: "MIN_NOTIONAL", notional: "1" },
      { filterType: "MAX_NUM_ORDERS", limit: 200 },
      { filterType: "PERCENT_PRICE", multiplierUp: "5", multiplierDown: "0.2", multiplierDecimal: "4" },
    ],
  };
}

/** the full tradable list injected into redux (SPX first = default selected market) */
export const PERPIFY_SYMBOLS = PERPIFY_MARKETS.map(exchangeInfoFor);

/** backward-compatible single-symbol export (SPX-PERP flagship) */
export const SPX_PERP_SYMBOL = PERPIFY_SYMBOLS[0];

export default SPX_PERP_SYMBOL;
