/**
 * Static SPX-PERP symbol metadata — the "exchange info" the app normally fetches from an
 * API. Injected into the tradablesymbolList redux slice by usePerpifyMarketData so every
 * precision/tick/step/min-notional-driven component (header price, order book rows, order
 * form, positions) populates. Binance-futures exchangeInfo shape (what SymbolPrecisionHelper
 * and the order form read). Single market for V1.
 */
export const SPX_PERP_SYMBOL = {
  symbol: "SPX-PERP",
  pair: "SPX-PERP",
  contractType: "PERPETUAL",
  status: "TRADING",
  baseAsset: "SPX",
  quoteAsset: "USDC",
  marginAsset: "USDC",
  pricePrecision: 2, // SPX index ~5,000–7,500, 2 decimals
  quantityPrecision: 4, // contracts, 4 decimals (engine qty is 1e8)
  baseAssetPrecision: 8,
  quotePrecision: 8,
  underlyingType: "INDEX",
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

export default SPX_PERP_SYMBOL;
