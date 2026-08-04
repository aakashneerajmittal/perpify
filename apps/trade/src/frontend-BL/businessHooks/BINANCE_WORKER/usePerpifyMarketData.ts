/**
 * usePerpifyMarketData — repoints the trade screen's market data from Binance to the
 * Perpify engine, for EVERY market the venue runs (SPX-PERP + the single-stock perps).
 * It connects to:
 *   /marketDataStream?symbol=<S>  → that market's live mark/index/gap-coefficient (one socket
 *                                   per market, so the header + symbol picker have live prices
 *                                   for all markets and switching is instant)
 *   /v1/ws/order-book             → aggregated depth for the SELECTED market (re-subscribed
 *                                   whenever the user switches markets)
 * and dispatches into the SAME Redux shapes the existing header/order-book components read
 * (SET_BINANCE_DATA keyed by `${sym}@markPrice@1s` / `@ticker` / `@gapCoefficient`, SET_ASKS/
 * SET_BIDS as [[price,qty]] with the message's symbol), so the UI populates with real engine
 * data for whichever market is selected.
 */
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { BASE_URL } from "@/frontend-api-service/Base";
import { PERPIFY_MARKETS, PERPIFY_SYMBOLS } from "@/config/perpifySymbol";
import { setPerpifyMark } from "@/frontend-api-service/perpifyWsBridge";

const DEFAULT_SYMBOL = "SPX-PERP";

export default function usePerpifyMarketData({ tradeScreen }: { tradeScreen?: boolean } = {}) {
  const dispatch = useDispatch();
  const selectedSymbol = useSelector((state: any) => state?.selectSymbol?.selectedSymbol) || DEFAULT_SYMBOL;
  const selectedRef = useRef<string>(selectedSymbol);
  selectedRef.current = selectedSymbol;

  const binanceData = useRef<Record<string, string>>({});
  const stats = useRef<Record<string, { open?: number; high: number; low: number }>>({});
  const bookWsRef = useRef<WebSocket | null>(null);

  // ---- market data: one stream per market, plus the shared order-book socket ----
  useEffect(() => {
    // 1) declare every market + its metadata (precision/tick/step), seed a default selection
    dispatch({ type: "SET_TRADABLE_SYMBOL_LIST_SUCCESS", payload: { tradablesymbolList: PERPIFY_SYMBOLS } });
    if (!selectedRef.current) selectedRef.current = DEFAULT_SYMBOL;
    dispatch({ type: "SET_SELECTED_SYMBOL_SUCCESS", payload: { selectedSymbol: selectedRef.current } });
    dispatch({ type: "SET_ORDER_BOOK_LOADING", payload: selectedRef.current });
    // Default leverage + isolated margin type for EVERY market's order-form preview and
    // position rows (normally seeded from REST calls the engine doesn't serve). Without these
    // the margin preview is NaN and PositionRow crashes on marginType.toLowerCase().
    for (const s of PERPIFY_SYMBOLS) {
      dispatch({ type: "SET_LEVERAGE_POS_RISK", payload: { sym: s.symbol, leverage: 10 } });
      dispatch({ type: "SET_MARGIN_TYPE", payload: { sym: s.symbol, marginType: "ISOLATED" } });
    }
    dispatch({ type: "BINANCE_WS_OPENED", payload: { connecting: false, opened: true } });

    const wsBase = BASE_URL().binanceWsBase.replace(/\/marketDataStream$/, ""); // → ws://<engine>
    let closed = false;
    const sockets: WebSocket[] = [];

    const open = (path: string, onMsg: (m: any) => void, onOpen?: (ws: WebSocket) => void) => {
      let ws: WebSocket;
      try { ws = new WebSocket(wsBase + path); } catch { return; }
      (ws as any)._last = Date.now();
      sockets.push(ws);
      ws.onopen = () => { (ws as any)._last = Date.now(); onOpen?.(ws); };
      ws.onmessage = (ev) => { (ws as any)._last = Date.now(); try { onMsg(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { if (!closed) setTimeout(() => open(path, onMsg, onOpen), 2000); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };

    // Heartbeat + dead-connection watchdog. A wss stream can go "half-open" on the live network
    // (readyState stays OPEN but no data flows and onclose never fires), which froze the mark
    // price and the whole market-data feed. These streams push ~1/s, so >20s of silence means the
    // socket is dead: close it to trigger the reconnect above. A periodic ping keeps proxies warm.
    const heartbeat = setInterval(() => {
      const now = Date.now();
      for (const ws of sockets) {
        if (ws.readyState !== 1) continue;
        if (now - ((ws as any)._last || now) > 20000) {
          try { ws.close(); } catch { /* triggers reconnect */ }
          continue;
        }
        try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* noop */ }
      }
    }, 8000);

    const handleMark = (sym: string, m: any) => {
      const key = sym.toLowerCase();
      const pxNum = Number(m.p);
      const px = String(m.p);
      if (!(pxNum > 0)) return;
      const st = (stats.current[key] ??= { high: -Infinity, low: Infinity });
      if (st.open === undefined) st.open = pxNum;
      st.high = Math.max(st.high, pxNum);
      st.low = Math.min(st.low, pxNum);
      const changePct = st.open ? (((pxNum - st.open) / st.open) * 100).toFixed(2) : "0.00";

      // keyed market-data map — powers the header for the selected symbol AND the live prices
      // in the symbol picker for every symbol
      binanceData.current[`${key}@markPrice@1s`] = px;
      binanceData.current[`${key}@ticker`] = px;
      binanceData.current[`${key}@indexPrice`] = String(m.i);
      binanceData.current[`${key}@gapCoefficient`] = String(m.gc); // Perpify extension
      binanceData.current[`${key}@session`] = String(m.session || "live"); // live | reduce-only
      binanceData.current[`${key}@conf`] = String(m.conf ?? ""); // oracle confidence 0..1
      binanceData.current[`${key}@per`] = changePct;
      // 24h header stats (session-relative on testnet) — the header's DayData/Change24 read these
      // straight from redux (the old Binance web-worker ticker path never fires under Perpify).
      binanceData.current[`${key}@high`] = String(st.high);
      binanceData.current[`${key}@low`] = String(st.low);
      binanceData.current[`${key}@priceChange`] = st.open ? (pxNum - st.open).toFixed(2) : "0";
      binanceData.current[`${key}@vol`] = String(Math.round(4000 + (st.high - st.low) * 60)); // synthetic testnet turnover
      dispatch({ type: "SET_BINANCE_DATA", payload: { ...binanceData.current } });

      // 24h ticker row per symbol (session-relative on testnet)
      dispatch({
        type: "SET_ALL_TICKER_DATA",
        payload: {
          symbol: sym,
          percentage: changePct,
          lp: px,
          vol: "0",
          open: String(st.open),
          high: String(st.high),
          low: String(st.low),
          numberofTrades: 0,
          previousLTP: px,
          priceChange: st.open ? (pxNum - st.open).toFixed(2) : "0",
          colorIndicator: pxNum >= (st.open ?? pxNum) ? 1 : 0,
          markPrice: px,
          indexPrice: String(m.i),
        },
      });

      // index/funding snapshot + market-order reference price: only for the SELECTED market
      if (sym === selectedRef.current) {
        setPerpifyMark(pxNum);
        const indexNum = Number(m.i) || pxNum;
        const premium = indexNum ? (pxNum - indexNum) / indexNum : 0;
        const fundingRate = Math.max(-0.0075, Math.min(0.0075, premium));
        const nextFundingTs = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
        dispatch({
          type: "SET_MARKPRICE_SNAPSHOT",
          payload: { [`${key}@markPrice@1s`]: px, indexPrice: String(m.i), fundingRate, countDown: nextFundingTs },
        });
      }
    };

    // 2) one market-data socket per market
    for (const meta of PERPIFY_MARKETS) {
      const sym = meta.symbol;
      open(`/marketDataStream?symbol=${encodeURIComponent(sym)}`, (m) => {
        if (m?.e !== "markPriceUpdate") return;
        handleMark(sym, m);
      });
    }

    // 3) one order-book socket, subscribed to the currently-selected market (re-subscribed
    //    by the effect below when the user switches). The engine tags each snapshot with its
    //    symbol (`m.s`), so we dispatch against that.
    open(
      "/v1/ws/order-book",
      (m) => {
        if (!m?.s || !m.b) return;
        const asks = (m.a || []).map((l: any) => [String(l.P), String(l.Q)]);
        const bids = (m.b || []).map((l: any) => [String(l.P), String(l.Q)]);
        if (asks.length) dispatch({ type: "SET_ASKS", payload: { s: m.s, a: asks } });
        if (bids.length) dispatch({ type: "SET_BIDS", payload: { s: m.s, b: bids } });
        dispatch({ type: "SET_ORDER_BOOK_BINANCE", payload: { asks, bids } });
      },
      (ws) => {
        bookWsRef.current = ws;
        ws.send(JSON.stringify({ symbol: selectedRef.current, limit: 12, decimal: 2, interval: 400 }));
      },
    );

    return () => {
      closed = true;
      clearInterval(heartbeat);
      for (const ws of sockets) { try { ws.close(); } catch {} }
      bookWsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- re-point the order book when the selected market changes ----
  useEffect(() => {
    if (!selectedSymbol) return;
    dispatch({ type: "SET_ORDER_BOOK_LOADING", payload: selectedSymbol });
    const ws = bookWsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ symbol: selectedSymbol, limit: 12, decimal: 2, interval: 400 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);
}
