import { fetchAllOpenOrdersApi, generateAuthenticatedWebSocketUrl } from "../../../../frontend-api-service/Api";
import {
  DENSITY_WS_CONNECT,
  DENSITY_WS_CLOSED,
  DENSITY_WS_DISCONNECT,
  DENSITY_WS_OPENED,
  OPEN_ORDERS_WEB_STREAM,
  WS_ORDER_TRIGGER,
  DENSITY_WS_SUBSCRIBE_CREATE_ORDER,
  DENSITY_WS_SUBSCRIBE_CLOSE_ORDER,
  ERASE_POSITION_DIRECTORY,
  OPEN_ORDERS_UPDATE_SIZE_STREAM,
  OPEN_ORDERS_FETCH_SUCCESS,
  CLEAR_UNREALISED_PROFITLOSS,
  CREATE_POSIITON_ACCOUNT_INFO,
  REMOVE_POSITIONS_QUANT
} from "../../../redux/constants/Constants";
import {
  accountUpdateHandler,
  checkForPositions,
  checkForCancelledOrExpiredOrFilledOrders,
  checkForExistingOrderId,
  checkForLiquidatedPosition,
  checkForOpenOrders,
  checkForPartiallyFilledOrders,
  positionsHandler,
  removeOrderFromSnapshot,
  removeOrderFromStream,
  updateFilledSizeForSnapshot,
  updateFilledSizeForStream
} from "../../../services/DensityWebSocketService/PositionHelpers";
import { deleteApiOrderIdFromStore } from "../../../redux/actions/Futures/saveOrderDetails.ac";
import { GENERATE_TOKEN } from "../../actions/User/GenerateToken.ac";
import { fetchFutureAccountDetails, applyPerpifyAccountBalances } from "../../actions/Futures/Futures.ac";
import { fetchAccountPositionInfo } from "../../actions/User/AccountInfo.ac";
import { showSnackBar } from "../../actions/Internal/GlobalErrorHandler.ac";
import { posthog } from "posthog-js";
import { mergeArraysWithoutCommonElements } from "./DensityWebSocketHelper";
import { setPerpifySocket } from "../../../../frontend-api-service/perpifyWsBridge";

const densitySocketMiddleware = () => {
  let socket = null;
  let PongRecived = false;
  let pingTimerRef = null; // the heartbeat interval, so it can be cleared on death/reconnect
  let connecting = false; // a connect (async token/url fetch → new WebSocket) is in flight
  let outbox = []; // orders placed while the socket was down — flushed in order on (re)open
  let ReConnectWhenWsconnectionBreak = 0;
  let ApiPollingLimit = 0;
  let ApiPollingPongRecived = false;
  let symbolList = [];
  let OrderIdList = [];
  let OrderIdListFromStream = [];
  let EventType = "";

  // Flush any orders that were queued while the account socket was down. Called on every
  // (re)open so an order the trader placed during a reconnect actually reaches the engine
  // instead of being silently dropped ("order doesn't show under positions").
  const flushOutbox = () => {
    if (!(socket && socket.readyState === 1) || outbox.length === 0) return;
    const pending = outbox;
    outbox = [];
    for (const msg of pending) {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        outbox.push(msg); // still not sendable — requeue and wait for the next open
      }
    }
  };

  // Send an order now if the socket is OPEN; otherwise queue it and ensure a connect is in
  // flight so it flushes the moment the socket opens. This is what makes order intake robust
  // to the live network's half-open / reconnecting states.
  const sendOrQueue = (store, msg) => {
    if (socket && socket.readyState === 1) {
      try {
        socket.send(JSON.stringify(msg));
        return;
      } catch {
        /* fall through to queue + reconnect */
      }
    }
    if (outbox.length < 25) outbox.push(msg); // bound the queue; drop only under absurd spam
    store.dispatch({ type: DENSITY_WS_CONNECT }); // idempotent — no-op if already up/connecting
  };

  // Map an engine conditional order (TP/SL/stop trigger) to an OpenOrdersStream row so it shows
  // under Open Orders alongside limit orders. `isTrigger` makes the Cancel button route to
  // cancel_trigger; the price column shows the trigger price for a stop-market (which has no
  // limit price). Engine trigger fields: {id, symbol, side, triggerPrice, triggerAbove, qty,
  // limitPrice, reduceOnly}.
  const triggerToOpenOrder = (t) => {
    const hasLimit = Number(t.limitPrice) > 0;
    return {
      T: Date.now(),
      s: t.symbol,
      S: t.side,
      q: String(t.qty),
      p: String(hasLimit ? t.limitPrice : t.triggerPrice),
      sp: String(t.triggerPrice),
      o: hasLimit ? "STOP" : "STOP_MARKET",
      ot: hasLimit ? "STOP" : "STOP_MARKET",
      X: "NEW",
      x: "NEW",
      c: t.id,
      i: t.id,
      R: !!t.reduceOnly,
      ap: "0",
      z: "0",
      isTrigger: true,
      triggerAbove: t.triggerAbove
    };
  };

  const getWebSocketUrl = () =>
    GENERATE_TOKEN("websocket")
      .then(
        (result) => {
          return Promise.resolve(result);
        },
        (error) => {
          const message = error.toString();
          return Promise.reject(message);
        }
      )
      .then((userToken) => generateAuthenticatedWebSocketUrl(userToken));
  // fallback functions when ws_connection break;
  const TracePositionDatabySymbol = (payload, store) => {
    RemoveSymbolFromOrderIdListWhenEventReceived_MarketOrder(payload, store);
  };

  const TraceOrderDatabyId = (payload, store) => {
    const isOrderNew = payload.filter((item) => item.ID === OrderIdList[0]);
    if (isOrderNew.length > 0) {
      OrderIdList.shift();
      fetchAllOpenOrdersApi().then((openOrders) => {
        store.dispatch({
          type: OPEN_ORDERS_UPDATE_SIZE_STREAM,
          payload: []
        });
        store.dispatch({
          type: OPEN_ORDERS_FETCH_SUCCESS,
          payload: openOrders.data.data
        });
      });
    }
  };
  function startApiPollingWhenStreamNotConnected(store, callback) {
    // sending ping before creating a new order  for check stream is connected or not
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
    // wait for pong  if recievied then wait for a stream event else disconnect ws stream and start polling;

    const ApiPollingPongTimer = setTimeout(() => {
      if (OrderIdList.length > 0) {
        OrderIdList = mergeArraysWithoutCommonElements(OrderIdListFromStream, OrderIdList);
      }
      if (OrderIdList.length > 0 || symbolList.length > 0 || ApiPollingPongRecived !== true) {
        OrderIdListFromStream = [];
        store.dispatch({ type: DENSITY_WS_DISCONNECT });
        callback(store);
      } else {
        OrderIdListFromStream = [];
        OrderIdList = [];
        symbolList = [];
        EventType = "";
        clearTimeout(ApiPollingPongTimer);
      }
    }, 5000);
  }
  function handleCreateMarketOrderEvent(store) {
    const PongTimer = setInterval(() => {
      if (ApiPollingLimit < 5) {
        ApiPollingLimit++;
        if (symbolList.length !== 0) {
          store.dispatch(fetchAccountPositionInfo(TracePositionDatabySymbol, store));
          fetchAllOpenOrdersApi().then((openOrders) => {
            store.dispatch({
              type: OPEN_ORDERS_UPDATE_SIZE_STREAM,
              payload: []
            });
            store.dispatch({ type: CLEAR_UNREALISED_PROFITLOSS });
            store.dispatch({
              type: OPEN_ORDERS_FETCH_SUCCESS,
              payload: openOrders.data.data
            });
          });
          store.dispatch(fetchFutureAccountDetails());
        } else {
          clearInterval(PongTimer);
          store.dispatch({ type: DENSITY_WS_CONNECT });
          ApiPollingPongRecived = false;
          ApiPollingLimit = 0;
        }
      } else {
        clearInterval(PongTimer);
        store.dispatch({ type: DENSITY_WS_CONNECT });
        ApiPollingPongRecived = false;
        ApiPollingLimit = 0;
        symbolList = [];
        store.dispatch({
          type: ERASE_POSITION_DIRECTORY,
          payload: null
        });
        store.dispatch({ type: CLEAR_UNREALISED_PROFITLOSS });
        store.dispatch(fetchAccountPositionInfo());
        fetchAllOpenOrdersApi().then((openOrders) => {
          store.dispatch({
            type: OPEN_ORDERS_UPDATE_SIZE_STREAM,
            payload: []
          });
          store.dispatch({
            type: OPEN_ORDERS_FETCH_SUCCESS,
            payload: openOrders.data.data
          });
        });
      }
    }, 1000);
  }

  function handleCreateLimitsOrderEvent(store) {
    const PongTimer = setInterval(() => {
      if (ApiPollingLimit < 5) {
        ApiPollingLimit++;
        if (OrderIdList.length !== 0) {
          fetchAllOpenOrdersApi().then((openOrders) => {
            TraceOrderDatabyId(openOrders.data.data, store);
          });
          store.dispatch(fetchAccountPositionInfo());
          store.dispatch(fetchFutureAccountDetails());
        } else {
          clearInterval(PongTimer);
          store.dispatch({ type: DENSITY_WS_CONNECT });
          ApiPollingPongRecived = false;
          ApiPollingLimit = 0;
        }
      } else {
        clearInterval(PongTimer);
        store.dispatch({ type: DENSITY_WS_CONNECT });
        ApiPollingPongRecived = false;
        ApiPollingLimit = 0;
        OrderIdList = [];
        store.dispatch({
          type: ERASE_POSITION_DIRECTORY,
          payload: null
        });
        store.dispatch(fetchAccountPositionInfo());
        store.dispatch({ type: CLEAR_UNREALISED_PROFITLOSS });
        fetchAllOpenOrdersApi().then((openOrders) => {
          store.dispatch({
            type: OPEN_ORDERS_UPDATE_SIZE_STREAM,
            payload: []
          });
          store.dispatch({
            type: OPEN_ORDERS_FETCH_SUCCESS,
            payload: openOrders.data.data
          });
        });
      }
    }, 1000);
  }

  function RemoveSymbolFromOrderIdListWhenEventReceived_MarketOrder(payload, store) {
    if (EventType === "CLOSE_ORDER") {
      const SET = new Set([...symbolList]);
      symbolList = payload.filter((item) => SET.has(item.symbol));
      if (symbolList.length === 0) {
        store.dispatch({
          type: ERASE_POSITION_DIRECTORY,
          payload: null
        });
        store.dispatch({ type: CLEAR_UNREALISED_PROFITLOSS });
        store.dispatch(fetchAccountPositionInfo());
        EventType = "";
      }
    } else {
      const isOrderFullFill = payload.filter((item) => item.symbol === symbolList[0]);

      if (isOrderFullFill.length > 0) {
        symbolList.shift();
      }
    }
  }

  const onOpen = (store, ws) => () => {
    if (ws !== socket) {
      // a newer socket already replaced this one (fast reconnect) — let the stale one die
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }
    posthog?.capture("WEBSCOKET_OPEN", {
      event_time: new Date().toUTCString()
    });
    connecting = false;
    ReConnectWhenWsconnectionBreak = 0; // a fresh healthy open refreshes the reconnect budget
    startPongTimer(store);
    store.dispatch({
      type: DENSITY_WS_OPENED,
      payload: { connecting: false, opened: true }
    });
    flushOutbox(); // deliver any orders queued while we were reconnecting
  };

  function startPongTimer(store) {
    // Heartbeat + dead-connection watchdog for the account socket. A wss connection can go
    // "half-open" on the live network (Render / proxies / mobile): readyState stays OPEN but no
    // bytes flow — the browser never fires onclose, so nothing reconnects and the UI freezes
    // (mark price stops, orders never send → "order doesn't show under positions"). Each cycle
    // we clear the pong flag, ping, and if no pong comes back in time we force a reconnect.
    //
    // The critical bug this fixes: PongRecived used to be set true on the first pong and never
    // reset before subsequent pings, so after one pong the check `PongRecived !== true` was
    // permanently false and a dead socket was NEVER detected or reconnected.
    if (pingTimerRef) {
      clearInterval(pingTimerRef);
      pingTimerRef = null;
    }
    PongRecived = false;
    try {
      socket.send(JSON.stringify({ type: "ping" }));
    } catch {
      /* socket already dead — the watchdog below will reconnect */
    }
    pingTimerRef = setInterval(() => {
      PongRecived = false; // reset before every ping so each cycle is judged fresh
      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        /* dead socket send throws — fall through to the pong check */
      }
      setTimeout(() => {
        if (PongRecived !== true) {
          // no pong within the window → the connection is half-open/dead. Stop this timer and
          // close the socket; its onClose is the single reconnect authority and opens a fresh
          // one. (We deliberately do NOT dispatch DISCONNECT here — that path is for intentional
          // teardown and does not auto-reconnect.) Refresh the account snapshot meanwhile.
          if (pingTimerRef) {
            clearInterval(pingTimerRef);
            pingTimerRef = null;
          }
          try {
            socket && socket.close();
          } catch {
            /* onClose handles the reconnect */
          }
          store.dispatch(fetchAccountPositionInfo());
          store.dispatch(fetchFutureAccountDetails());
          fetchAllOpenOrdersApi().then((openOrders) => {
            store.dispatch({ type: OPEN_ORDERS_UPDATE_SIZE_STREAM, payload: [] });
            store.dispatch({ type: CLEAR_UNREALISED_PROFITLOSS });
            store.dispatch({ type: OPEN_ORDERS_FETCH_SUCCESS, payload: openOrders.data.data });
          });
        }
      }, 5000); // allow for live wss round-trip latency (was 1s, too tight)
    }, 15000);
  }

  const onError = (store, ws) => () => {
    posthog?.capture("WEBSCOKET_ERROR", {
      event_time: new Date().toUTCString()
    });
    if (ws !== socket) return; // stale socket's error — ignore
    // A ws error is (almost) always immediately followed by onClose. Let onClose be the single
    // reconnect authority: just ensure this socket is closing. We deliberately do NOT raise the
    // "server is facing some issues" snackbar here — on a flaky live network transient errors are
    // routine and self-heal via reconnect; a scary popup on every blip is worse than silence.
    try {
      ws.close();
    } catch {
      /* onClose reconnects */
    }
  };

  const onClose = (store, ws) => () => {
    posthog?.capture("WEBSCOKET_CLOSE", {
      event_time: new Date().toUTCString()
    });
    if (ws !== socket) return; // a newer socket already replaced this one — ignore the stale close
    // This is the SINGLE reconnect authority for an *unexpected* close. Stop the dead socket's
    // heartbeat, clear it, mark the connection closed (which also nudges the SideBar effect to
    // re-connect), and schedule one bounded/backing-off reconnect. The retry budget resets to 0
    // on every healthy open (onOpen), so it only exhausts if the engine is genuinely unreachable.
    if (pingTimerRef) {
      clearInterval(pingTimerRef);
      pingTimerRef = null;
    }
    connecting = false;
    socket = null;
    setPerpifySocket(null);
    store.dispatch({
      type: DENSITY_WS_CLOSED,
      payload: { connecting: false, opened: false }
    });
    if (ReConnectWhenWsconnectionBreak < 12) {
      ReConnectWhenWsconnectionBreak++;
      const delay = Math.min(1500 * ReConnectWhenWsconnectionBreak, 8000);
      setTimeout(() => store.dispatch({ type: DENSITY_WS_CONNECT }), delay);
    }
  };

  const WS_MESSAGESS = {
    ORDER_TRADE_UPDATE: "ORDER_TRADE_UPDATE",
    ACCOUNT_UPDATE: "ACCOUNT_UPDATE"
  };

  const onMessage = (store) => (event) => {
    if (JSON.parse(event.data).type === "pong") {
      PongRecived = true;
      ApiPollingPongRecived = true;
      ReConnectWhenWsconnectionBreak = 0; // a confirmed round-trip = healthy; reset the retry budget
    }
    // PERPIFY: SESSION_INFO carries the trader's behavioral tier, tierMult (margin
    // multiplier), tier-gated maxLeverage, base margin bps, gap coefficient and the
    // named explainability factors. It uses a top-level `type` (not eventType), so
    // handle it before the eventType switch and store it for the tier UI.
    if (JSON.parse(event.data).type === "SESSION_INFO") {
      store.dispatch({ type: "SESSION_INFO_UPDATE", payload: JSON.parse(event.data) });
      return;
    }
    // PERPIFY: order/trade history over the socket (no REST history endpoint). SNAPSHOT paints
    // recent fills/cancels on connect (survives refresh); APPEND streams each new fill/cancel.
    if (JSON.parse(event.data).type === "ORDER_HISTORY_SNAPSHOT") {
      store.dispatch({ type: "PERPIFY_HISTORY_SNAPSHOT", payload: JSON.parse(event.data).records });
      return;
    }
    if (JSON.parse(event.data).type === "ORDER_HISTORY_APPEND") {
      store.dispatch({ type: "PERPIFY_HISTORY_APPEND", payload: JSON.parse(event.data).record });
      return;
    }
    // PERPIFY: armed conditional orders (TP/SL/stop) painted on connect. Replace any existing
    // trigger rows with the snapshot so they show under Open Orders and survive refresh.
    if (JSON.parse(event.data).type === "CONDITIONAL_ORDERS_SNAPSHOT") {
      const triggers = (JSON.parse(event.data).orders || []).map(triggerToOpenOrder);
      const nonTrigger = (store.getState().OpenOrdersStream.OpenOrdersStream || []).filter((o) => !o.isTrigger);
      store.dispatch({ type: OPEN_ORDERS_UPDATE_SIZE_STREAM, payload: [...nonTrigger, ...triggers] });
      return;
    }
    const payload = JSON.parse(event.data).eventData;
    const eventType = JSON.parse(event.data).eventType;

    JSON.parse(event.data).type !== "pong" &&
      posthog?.capture("WEBSCOKET_MESSAGE", {
        event_type: eventType,
        event_time: new Date().toUTCString()
      });

    switch (eventType) {
      case WS_MESSAGESS.ORDER_TRADE_UPDATE:
        if (checkForLiquidatedPosition(payload, store)) break;
        if (checkForOpenOrders(payload)) {
          OrderIdListFromStream.push(payload.c);
          if (OrderIdList[0] === payload.c) {
            OrderIdList.shift();
          }
          store.dispatch({ type: OPEN_ORDERS_WEB_STREAM, payload });
        }
        if (checkForPartiallyFilledOrders(payload)) {
          const clientOrderId = payload.c;
          store.dispatch(deleteApiOrderIdFromStore(clientOrderId));
          updateFilledSizeForSnapshot(payload, store);
          updateFilledSizeForStream(payload, store);
        }
        if (checkForCancelledOrExpiredOrFilledOrders(payload)) {
          const openOrderId = JSON.parse(event.data);
          removeOrderFromSnapshot(openOrderId.orderID, store);
          removeOrderFromStream(openOrderId.eventData.c, store);
        }
        if (checkForPositions(payload)) {
          if (symbolList[0] === payload.s) {
            symbolList.shift();
          }
          const clientOrderId = payload.c;
          if (checkForExistingOrderId(store, clientOrderId)) return;
          store.dispatch({ type: WS_ORDER_TRIGGER });
          store.dispatch(deleteApiOrderIdFromStore(clientOrderId));
          positionsHandler(payload, store);
        }
        break;

      case WS_MESSAGESS.ACCOUNT_UPDATE: {
        // PERPIFY: this is the AUTHORITATIVE full account snapshot — balance + EVERY open
        // position across markets — sent on connect and after every fill/close. Density
        // repopulated the positions table from a REST snapshot on page load; our engine has no
        // such endpoint, so the table must be rebuilt from THIS message. Without it, positions
        // vanished on refresh (the connect ACCOUNT_UPDATE only updated margin, never the rows)
        // and a closed position could linger. It is also the tail message of every command
        // (emitted after the ORDER_TRADE_UPDATEs), so treating its positions as absolute truth
        // corrects any drift from the incremental fill path.
        const acctPositions = Array.isArray(payload?.positions) ? payload.positions : [];
        const liveSyms = new Set();
        for (const p of acctPositions) {
          accountUpdateHandler(p, store); // margin type + isolated wallet (unchanged)
          const qty = Number(p?.quantity ?? p?.pa ?? 0);
          const sym = (p?.symbol ?? p?.s ?? "").toString();
          if (!sym || !(Math.abs(qty) > 0)) continue;
          liveSyms.add(sym.toUpperCase());
          const lev = (store.getState().positionsDirectory.leverage || []).find((l) => l?.sym?.toUpperCase() === sym.toUpperCase());
          store.dispatch({
            type: CREATE_POSIITON_ACCOUNT_INFO,
            payload: {
              sym,
              side: qty >= 0 ? "BUY" : "SELL",
              entryPrice: Number(p?.entryPrice ?? p?.ep ?? 0),
              posAmt: qty,
              leverage: lev ? Number(lev.leverage) : 0,
              marginType: (p?.marginType ?? "isolated").toString().toUpperCase(),
              isolatedWallet: Number(p?.isolatedWallet ?? p?.iw ?? 0)
            }
          });
        }
        // remove any rows the snapshot no longer contains (position closed → drop from the table)
        const currentRows = store.getState().positionsDirectory.currentPositions || [];
        for (const row of currentRows) {
          if (row?.sym && !liveSyms.has(row.sym.toUpperCase())) {
            store.dispatch({ type: REMOVE_POSITIONS_QUANT, payload: row.sym });
          }
        }
        store.dispatch(applyPerpifyAccountBalances(payload));
        break;
      }
      case "LIQUIDATION_EXPLAINER":
        // PERPIFY: signed liquidation explainer — surfaced as a modal (why you were
        // liquidated: tier, gap coeff, oracle confidence, equity<MM, proof hash).
        store.dispatch({ type: "LIQUIDATION_EXPLAINER", payload });
        break;
      case "CONDITIONAL_ORDER_UPDATE": {
        // PERPIFY: a TP/SL/stop trigger armed (add to Open Orders), fired, or was canceled
        // (remove it). Without this the trigger reached the engine but never showed in the UI.
        const st = payload?.status;
        const cur = store.getState().OpenOrdersStream.OpenOrdersStream || [];
        if (st === "ARMED") {
          if (!cur.some((o) => o.c === payload.id)) {
            store.dispatch({ type: OPEN_ORDERS_WEB_STREAM, payload: triggerToOpenOrder(payload) });
          }
        } else if (st === "FIRED" || st === "CANCELED") {
          store.dispatch({ type: OPEN_ORDERS_UPDATE_SIZE_STREAM, payload: cur.filter((o) => o.c !== payload.id) });
        }
        break;
      }
      case "ORDER_UPDATE":
        // PERPIFY: the engine sends a bare ORDER_UPDATE when it REJECTS an order outright
        // (e.g. "insufficient collateral" once the gap/tier-adjusted initial margin exceeds
        // free collateral). The Density stream never sent these, so this case did not exist and
        // the rejection was silently dropped — the trader saw the optimistic "order sent" toast
        // but got no fill, no position, and no reason ("order doesn't show under positions").
        // Surface it so the trader knows to reduce size / lower leverage.
        if (payload?.orderStatus === "REJECTED") {
          const reason = (payload?.statusRemarks || "insufficient collateral").toString();
          store.dispatch(
            showSnackBar({
              src: "PERPIFY_ORDER_REJECTED",
              message: `Order rejected: ${reason}. Try a smaller size or lower leverage.`,
              type: "failure"
            })
          );
        }
        break;
      default:
    }
  };

  // the middleware part of this function
  return (store) => (next) => (action) => {
    const { type, payload } = action;
    switch (type) {
      case DENSITY_WS_CONNECT: {
        // Idempotent connect. Guard on the socket's ACTUAL state — never on a hand-maintained
        // counter. If a socket is already CONNECTING or OPEN (or a connect's async token/url
        // fetch is already in flight), this is a no-op. Otherwise open a fresh socket and bind
        // its handlers to THIS instance, so a stale socket's late events can't clobber it.
        //
        // This replaces the previous `socketConnectionCount === 1` guard, which could wedge the
        // account stream permanently: DISCONNECT only reset the counter inside `if (socket !==
        // null)`, so a disconnect-while-null (routine in the live reconnect race) left the counter
        // stuck >= 2. The guard then never equalled 1 again, NO new socket was ever created, and
        // every order hit `socket.readyState !== 1` and was silently dropped — exactly the
        // "order doesn't show under positions" bug, with balance/positions frozen at funding.
        if (connecting) break;
        if (socket && (socket.readyState === 0 || socket.readyState === 1)) break;
        if (socket) {
          try {
            socket.close();
          } catch {
            /* noop */
          }
        }
        connecting = true;
        getWebSocketUrl()
          .then((url) => {
            let ws;
            try {
              ws = new WebSocket(url);
            } catch {
              connecting = false;
              return;
            }
            socket = ws;
            setPerpifySocket(ws); // expose to API-layer order/cancel helpers
            ws.onmessage = onMessage(store);
            ws.onclose = onClose(store, ws);
            ws.onopen = onOpen(store, ws);
            ws.onerror = onError(store, ws);
          })
          .catch(() => {
            // token/url fetch failed — clear the in-flight flag and schedule a bounded retry so
            // a transient auth/network hiccup at connect time still recovers on its own.
            connecting = false;
            if (ReConnectWhenWsconnectionBreak < 12) {
              ReConnectWhenWsconnectionBreak++;
              setTimeout(() => store.dispatch({ type: DENSITY_WS_CONNECT }), 2000);
            }
          });
        break;
      }

      case DENSITY_WS_DISCONNECT: {
        // Intentional teardown (offline, logout, unmount). ALWAYS fully reset — never gate the
        // reset on socket being non-null (that omission was the counter-wedge bug). We null
        // `socket` BEFORE closing the old one so its onClose sees a stale instance and does NOT
        // auto-reconnect. Marking the connection closed also nudges the SideBar effect, which
        // re-dispatches CONNECT whenever it should be online — so recovery is never lost.
        if (pingTimerRef) {
          clearInterval(pingTimerRef);
          pingTimerRef = null;
        }
        connecting = false;
        PongRecived = false;
        const dead = socket;
        socket = null;
        setPerpifySocket(null);
        if (dead) {
          try {
            dead.close();
          } catch {
            /* noop */
          }
        }
        store.dispatch({
          type: DENSITY_WS_CLOSED,
          payload: { connecting: false, opened: false }
        });
        break;
      }
      case DENSITY_WS_SUBSCRIBE_CREATE_ORDER: {
        if (payload?.type === "MARKET") {
          const symbolList3 = payload.data.map((item) => item?.symbol);
          symbolList = [...new Set([...symbolList3])];
          startApiPollingWhenStreamNotConnected(store, handleCreateMarketOrderEvent);
        } else {
          OrderIdList = payload.data.map((item) => item?.ID);
          startApiPollingWhenStreamNotConnected(store, handleCreateLimitsOrderEvent);
        }

        break;
      }
      case DENSITY_WS_SUBSCRIBE_CLOSE_ORDER: {
        EventType = payload.eventType;
        symbolList = payload.data.map((item) => item.symbol);
        startApiPollingWhenStreamNotConnected(store, handleCreateMarketOrderEvent);
        break;
      }
      // PERPIFY: order intake flows over the SAME authenticated account socket the fills
      // arrive on. The engine replies with ORDER_TRADE_UPDATE / ACCOUNT_UPDATE (handled above).
      // Placements go through sendOrQueue: if the socket is momentarily down/reconnecting the
      // order is queued and flushed the instant it opens, instead of being silently dropped.
      case "PERPIFY_PLACE_ORDER": {
        sendOrQueue(store, payload);
        break;
      }
      case "PERPIFY_PLACE_ORDER_SIGNED": {
        // EIP-712 wallet-signed order — payload is the ready {type:"place_order_signed",...} wire
        // msg (owner/qty8/price8/nonce/expiry/signature). Engine verifies before it touches the book.
        sendOrQueue(store, payload);
        break;
      }
      case "PERPIFY_MARKET_CLOSE": {
        // closing a position matters as much as opening one — queue-and-flush so a close placed
        // during a reconnect still lands. symbol present → that market; absent → every position.
        sendOrQueue(store, { type: "market_close", symbol: payload?.symbol });
        // Cancel the reduce-only brackets (TP/SL) attached to the position(s) being closed.
        // The engine's market_close only flattens the position; it leaves resting triggers armed,
        // so they used to orphan in Open Orders after the position went flat (and the Close-All
        // modal explicitly promises to cancel them). We cancel only reduce-only orders here so an
        // intentional resting *entry* order (a plain limit/stop the trader placed) is left alone.
        // symbol present → just that market's brackets; absent (Close All) → every held market's.
        // Mirrors the per-order cancel path (direct send, not queued: a stale cancel after a
        // reconnect could target an already-filled order).
        if (socket && socket.readyState === 1) {
          try {
            const openOrders = store.getState()?.OpenOrdersStream?.OpenOrdersStream || [];
            const only = payload?.symbol;
            openOrders.forEach((o) => {
              const osym = o?.s;
              if (only && osym !== only) return; // symbol given → scope to that market
              if (!o?.R) return; // reduce-only brackets only — leave resting entry orders intact
              const id = o?.i || o?.c;
              if (!id) return;
              socket.send(JSON.stringify(o?.isTrigger ? { type: "cancel_trigger", triggerId: id, symbol: osym } : { type: "cancel", orderId: id, symbol: osym }));
            });
          } catch (e) {
            // non-fatal: the close itself was already sent above
          }
        }
        break;
      }
      case "PERPIFY_PLACE_TRIGGER": {
        // conditional order (TP/SL/stop) — payload is already the {type:"place_trigger",...} wire msg
        sendOrQueue(store, payload);
        break;
      }
      case "PERPIFY_CANCEL_ORDER": {
        // cancels aren't queued (a stale cancel after reconnect could target a filled order) —
        // send if the socket is up, else kick a reconnect so the next action has a live socket.
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel", orderId: payload?.orderId, symbol: payload?.symbol }));
        else store.dispatch({ type: DENSITY_WS_CONNECT });
        break;
      }
      case "PERPIFY_CANCEL_TRIGGER": {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel_trigger", triggerId: payload?.triggerId, symbol: payload?.symbol }));
        else store.dispatch({ type: DENSITY_WS_CONNECT });
        break;
      }
      default:
        return next(action);
    }
  };
};

export default densitySocketMiddleware();
