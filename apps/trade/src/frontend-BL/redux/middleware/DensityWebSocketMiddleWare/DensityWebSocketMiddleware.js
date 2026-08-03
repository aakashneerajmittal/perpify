import { fetchAllOpenOrdersApi, generateAuthenticatedWebSocketUrl } from "../../../../frontend-api-service/Api";
import {
  DENSITY_WS_CONNECT,
  DENSITY_WS_CLOSED,
  DENSITY_WS_DISCONNECT,
  DENSITY_WS_OPENED,
  OPEN_ORDERS_WEB_STREAM,
  GLOBAL_ERROR_ADD,
  GLOBAL_ERROR_REMOVE,
  DENSITY_WEBSOCKET_CONNECTION,
  WS_ORDER_TRIGGER,
  DENSITY_WS_SUBSCRIBE_CREATE_ORDER,
  DENSITY_WS_SUBSCRIBE_CLOSE_ORDER,
  ERASE_POSITION_DIRECTORY,
  OPEN_ORDERS_UPDATE_SIZE_STREAM,
  OPEN_ORDERS_FETCH_SUCCESS,
  CLEAR_UNREALISED_PROFITLOSS
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
import { posthog } from "posthog-js";
import { mergeArraysWithoutCommonElements } from "./DensityWebSocketHelper";
import { setPerpifySocket } from "../../../../frontend-api-service/perpifyWsBridge";

const densitySocketMiddleware = () => {
  let socket = null;
  let PongRecived = false;
  let ReConnectWhenWsconnectionBreak = 0;
  let ApiPollingLimit = 0;
  let socketConnectionCount = 0;
  let ApiPollingPongRecived = false;
  let symbolList = [];
  let OrderIdList = [];
  let OrderIdListFromStream = [];
  let EventType = "";

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
    socket.send(JSON.stringify({ type: "ping" }));
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

  const onOpen = (store) => () => {
    posthog?.capture("WEBSCOKET_OPEN", {
      event_time: new Date().toUTCString()
    });
    startPongTimer(store);
    store.dispatch({
      type: DENSITY_WS_OPENED,
      payload: { connecting: false, opened: true }
    });
  };

  function startPongTimer(store) {
    if (ReConnectWhenWsconnectionBreak < 10) {
      socket.send(JSON.stringify({ type: "ping" }));
      // Initial ping
      // eslint-disable-next-line no-unused-vars
      const pingTimer = setInterval(() => {
        socket.send(JSON.stringify({ type: "ping" }));

        const PongTimer = setTimeout(() => {
          if (PongRecived !== true) {
            store.dispatch({ type: DENSITY_WS_DISCONNECT });

            store.dispatch(fetchAccountPositionInfo());
            store.dispatch(fetchFutureAccountDetails());
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
            store.dispatch({ type: DENSITY_WS_CONNECT });
          } else {
            clearTimeout(PongTimer);
          }
        }, 1000);
      }, 15000);
    } else {
      // window.location.reload();
      store.dispatch({ type: DENSITY_WS_DISCONNECT });
      ReConnectWhenWsconnectionBreak = 0;
    }
  }

  const onError = (store) => (e) => {
    posthog?.capture("WEBSCOKET_ERROR", {
      event_time: new Date().toUTCString()
    });
    if (ReConnectWhenWsconnectionBreak < 5) {
      // eslint-disable-next-line no-unused-vars
      const PongTimer = setTimeout(() => {
        store.dispatch({ type: DENSITY_WS_DISCONNECT });
        store.dispatch(fetchAccountPositionInfo());
        store.dispatch(fetchFutureAccountDetails());
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
        store.dispatch({ type: DENSITY_WS_CONNECT });
      }, 3000 * ReConnectWhenWsconnectionBreak);
    } else {
      store.dispatch({ type: DENSITY_WS_DISCONNECT });
      ReConnectWhenWsconnectionBreak = 0;
      // window.location.reload();
    }
    store.dispatch({
      type: GLOBAL_ERROR_ADD,
      payload: {
        src: DENSITY_WEBSOCKET_CONNECTION,
        errorMessage: `Our server is facing some issues `,
        dialogType: "failure",
        errorUi: "SNACKBAR",
        errorHandlerForReduxStateUpdation: () =>
          store.dispatch({
            type: GLOBAL_ERROR_REMOVE,
            payload: { src: DENSITY_WEBSOCKET_CONNECTION }
          })
      }
    });
  };

  const onClose = (store) => (e) => {
    posthog?.capture("WEBSCOKET_CLOSE", {
      event_time: new Date().toUTCString()
    });
    store.dispatch({ type: DENSITY_WS_DISCONNECT });
  };

  const WS_MESSAGESS = {
    ORDER_TRADE_UPDATE: "ORDER_TRADE_UPDATE",
    ACCOUNT_UPDATE: "ACCOUNT_UPDATE"
  };

  const onMessage = (store) => (event) => {
    if (JSON.parse(event.data).type === "pong") {
      PongRecived = true;
      ApiPollingPongRecived = true;
    }
    // PERPIFY: SESSION_INFO carries the trader's behavioral tier, tierMult (margin
    // multiplier), tier-gated maxLeverage, base margin bps, gap coefficient and the
    // named explainability factors. It uses a top-level `type` (not eventType), so
    // handle it before the eventType switch and store it for the tier UI.
    if (JSON.parse(event.data).type === "SESSION_INFO") {
      store.dispatch({ type: "SESSION_INFO_UPDATE", payload: JSON.parse(event.data) });
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

      case WS_MESSAGESS.ACCOUNT_UPDATE:
        // PERPIFY: engine streams the full balance here (no REST account endpoint on testnet).
        // positions[] carries EVERY open position across markets (empty right after funding),
        // so refresh each one's margin/isolated-wallet — not just the first.
        if (Array.isArray(payload?.positions)) {
          for (const p of payload.positions) accountUpdateHandler(p, store);
        }
        store.dispatch(applyPerpifyAccountBalances(payload));
        break;
      case "LIQUIDATION_EXPLAINER":
        // PERPIFY: signed liquidation explainer — surfaced as a modal (why you were
        // liquidated: tier, gap coeff, oracle confidence, equity<MM, proof hash).
        store.dispatch({ type: "LIQUIDATION_EXPLAINER", payload });
        break;
      default:
    }
  };

  // the middleware part of this function
  return (store) => (next) => (action) => {
    const { type, payload } = action;
    switch (type) {
      case DENSITY_WS_CONNECT:
        socketConnectionCount++;
        if (socket !== null) {
          socket.close();
          // socket.terminate();
        }
        // connect to the remote host
        // TODO : Optimize this approach
        if (socketConnectionCount === 1) {
          getWebSocketUrl().then((url) => {
            socket = new WebSocket(url);
            setPerpifySocket(socket); // expose to API-layer order/cancel helpers
            // const webWorker = new CreateWebWorker();
            // socket = webWorker?.worker;

            socket.addEventListener("message", function (event) {
              const { type, action } = event.data;
              if (type === "websocket") {
                // Handle WebSocket messages received from the web worker
                switch (action) {
                  case "open":
                    onOpen(store)();
                    break;
                  case "onmessage":
                    onMessage(store)(event?.data);
                    break;
                  case "onerror":
                    onError(store)(event?.data?.error);
                    break;
                  case "onclose":
                    onClose(store)();
                    break;
                }
              }
            });

            // socket.postMessage({ type: "websocket", payload: { url } });

            // websocket handlers
            socket.onmessage = onMessage(store);
            socket.onclose = onClose(store);
            socket.onopen = onOpen(store);
            socket.onerror = onError(store);
            return Promise.resolve();
          });
        }
        break;

      case DENSITY_WS_DISCONNECT:
        if (socket !== null) {
          ReConnectWhenWsconnectionBreak++;
          socket.close();
          store.dispatch({
            type: DENSITY_WS_CLOSED,
            payload: { connecting: false, opened: false }
          });
          //  socket.terminate();
          socketConnectionCount = 0;
          PongRecived = false;
        }
        socket = null;
        setPerpifySocket(null);
        break;
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
      case "PERPIFY_PLACE_ORDER": {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
        break;
      }
      case "PERPIFY_PLACE_ORDER_SIGNED": {
        // EIP-712 wallet-signed order — payload is the ready {type:"place_order_signed",...} wire
        // msg (owner/qty8/price8/nonce/expiry/signature). Engine verifies before it touches the book.
        if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
        break;
      }
      case "PERPIFY_CANCEL_ORDER": {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel", orderId: payload?.orderId, symbol: payload?.symbol }));
        break;
      }
      case "PERPIFY_MARKET_CLOSE": {
        // symbol present → close that market's position; absent → close every open position
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "market_close", symbol: payload?.symbol }));
        break;
      }
      case "PERPIFY_PLACE_TRIGGER": {
        // conditional order (TP/SL/stop) — payload is already the {type:"place_trigger",...} wire msg
        if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
        break;
      }
      case "PERPIFY_CANCEL_TRIGGER": {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel_trigger", triggerId: payload?.triggerId, symbol: payload?.symbol }));
        break;
      }
      default:
        return next(action);
    }
  };
};

export default densitySocketMiddleware();
