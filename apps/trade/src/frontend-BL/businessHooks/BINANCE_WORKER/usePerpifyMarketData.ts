/**
 * usePerpifyMarketData — repoints the trade screen's market data from Binance to the
 * Perpify engine. Replaces useHandleBinanceSocketSubs. It connects to:
 *   /marketDataStream   → live SPX-PERP mark/index/gap-coefficient
 *   /v1/ws/order-book   → aggregated depth
 * and dispatches into the SAME Redux shapes the existing header/order-book components read
 * (SET_BINANCE_DATA keyed by `${sym}@markPrice@1s` / `@ticker`, SET_ASKS/SET_BIDS as
 * [[price,qty]] with a matching symbol), so the UI populates with real engine data.
 *
 * Single market for V1: everything is keyed to SPX-PERP.
 */
import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { BASE_URL } from "@/frontend-api-service/Base";
import SPX_PERP_SYMBOL from "@/config/perpifySymbol";

const SYMBOL = "SPX-PERP";
const KEY = SYMBOL.toLowerCase(); // "spx-perp" — the header reads `${selectedSymbol}@markPrice@1s`

export default function usePerpifyMarketData({ tradeScreen }: { tradeScreen?: boolean } = {}) {
  const dispatch = useDispatch();
  const binanceData = useRef<Record<string, string>>({});
  const stats = useRef<{ open?: number; high: number; low: number }>({ high: -Infinity, low: Infinity });

  useEffect(() => {
    // 1) declare the market + its metadata (precision/tick/step), mark the socket "open"
    dispatch({ type: "SET_TRADABLE_SYMBOL_LIST_SUCCESS", payload: { tradablesymbolList: [SPX_PERP_SYMBOL] } });
    dispatch({ type: "SET_SELECTED_SYMBOL_SUCCESS", payload: { selectedSymbol: SYMBOL } });
    dispatch({ type: "SET_ORDER_BOOK_LOADING", payload: SYMBOL }); // sets OrderBook.symbol = SPX-PERP
    dispatch({ type: "BINANCE_WS_OPENED", payload: { connecting: false, opened: true } });
    // Default leverage for the order form's margin/cost preview (normally seeded from a REST
    // leverage-bracket call the engine doesn't serve). Without an entry here leverageFromServer
    // is undefined → NaN margin → "Max Buying Power --" and a permanently disabled order button.
    dispatch({ type: "SET_LEVERAGE_POS_RISK", payload: { sym: SYMBOL, leverage: 10 } });
    // Seed the margin type (engine V1 is isolated-only). A market fill's ORDER_TRADE_UPDATE
    // arrives before the position's ACCOUNT_UPDATE, so createNewPosition needs this entry present
    // up front — otherwise the new position's marginType is undefined and PositionRow crashes on
    // marginType.toLowerCase().
    dispatch({ type: "SET_MARGIN_TYPE", payload: { sym: SYMBOL, marginType: "ISOLATED" } });

    const wsBase = BASE_URL().binanceWsBase.replace(/\/marketDataStream$/, ""); // → ws://<engine>
    let closed = false;
    const sockets: WebSocket[] = [];

    const open = (path: string, onMsg: (m: any) => void, onOpen?: (ws: WebSocket) => void) => {
      let ws: WebSocket;
      try { ws = new WebSocket(wsBase + path); } catch { return; }
      sockets.push(ws);
      ws.onopen = () => onOpen?.(ws);
      ws.onmessage = (ev) => { try { onMsg(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { if (!closed) setTimeout(() => open(path, onMsg, onOpen), 2000); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };

    // 2) mark/index/gap coefficient → header price + ticker + 24h stats
    open("/marketDataStream", (m) => {
      if (m?.e !== "markPriceUpdate") return;
      const pxNum = Number(m.p);
      const px = String(m.p);
      const s = stats.current;
      if (s.open === undefined) s.open = pxNum;
      s.high = Math.max(s.high, pxNum);
      s.low = Math.min(s.low, pxNum);
      const changePct = s.open ? (((pxNum - s.open) / s.open) * 100).toFixed(2) : "0.00";

      binanceData.current[`${KEY}@markPrice@1s`] = px;
      binanceData.current[`${KEY}@ticker`] = px;
      binanceData.current[`${KEY}@indexPrice`] = String(m.i);
      binanceData.current[`${KEY}@gapCoefficient`] = String(m.gc); // Perpify extension
      binanceData.current[`${KEY}@per`] = changePct;
      dispatch({ type: "SET_BINANCE_DATA", payload: { ...binanceData.current } });
      dispatch({ type: "SET_MARKPRICE_SNAPSHOT", payload: { [`${KEY}@markPrice@1s`]: px, indexPrice: String(m.i) } });

      // 24h ticker row (session-relative on testnet) → day high/low/change, LTP
      dispatch({
        type: "SET_ALL_TICKER_DATA",
        payload: {
          symbol: SYMBOL,
          percentage: changePct,
          lp: px,
          vol: "0",
          open: String(s.open),
          high: String(s.high),
          low: String(s.low),
          numberofTrades: 0,
          previousLTP: px,
          priceChange: s.open ? (pxNum - s.open).toFixed(2) : "0",
          colorIndicator: pxNum >= (s.open ?? pxNum) ? 1 : 0,
          markPrice: px,
          indexPrice: String(m.i),
        },
      });
    });

    // 3) aggregated book → SET_ASKS / SET_BIDS ([[price, qty]] with matching symbol)
    open(
      "/v1/ws/order-book",
      (m) => {
        if (m?.s !== SYMBOL || !m.b) return;
        const asks = (m.a || []).map((l: any) => [String(l.P), String(l.Q)]);
        const bids = (m.b || []).map((l: any) => [String(l.P), String(l.Q)]);
        if (asks.length) dispatch({ type: "SET_ASKS", payload: { s: SYMBOL, a: asks } });
        if (bids.length) dispatch({ type: "SET_BIDS", payload: { s: SYMBOL, b: bids } });
        dispatch({ type: "SET_ORDER_BOOK_BINANCE", payload: { asks, bids } });
      },
      (ws) => ws.send(JSON.stringify({ symbol: SYMBOL, limit: 12, decimal: 2, interval: 400 })),
    );

    return () => {
      closed = true;
      for (const ws of sockets) { try { ws.close(); } catch {} }
    };
  }, []);
}
