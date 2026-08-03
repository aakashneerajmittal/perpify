/* eslint-disable no-unused-vars */
import { saveOrderDetails } from "../../../redux/actions/Futures/saveOrderDetails.ac";
import axiosWithApiServer from "../../../../frontend-api-service/Utils/axiosHelpers/axiosWithApiServer";
import {
  GLOBAL_ERROR_REMOVE,
  GLOBAL_ERROR_ADD,
  ORDER_CREATION_SUCESS,
  ORDER_CREATION_FAIL,
  ORDER_CREATION_TP_SL_SUCESS,
  ORDER_CREATION_TP_SL_FAIL,
  DENSITY_WS_SUBSCRIBE_CREATE_ORDER
} from "../../../../frontend-BL/redux/constants/Constants";
import { getMetaDataApi, postMetaDataApi, placeOCOOrderApi } from "../../../../frontend-api-service/Api";
import { showSnackBar } from "../../../../frontend-BL/redux/actions/Internal/GlobalErrorHandler.ac";
import { FEATURES } from "../../../../config/perpifyFeatures";
import { isRealWallet, getWallet } from "../../../../config/perpifySession";
import { signOrder, toWirePayload, nextNonce, hasInjectedSigner } from "../../../auth/eip712Order";
const MapOrder = {
  LIMIT: "Limit",
  MARKET: "Market",
  STOP_MARKET: "Stop Market",
  STOP: "Stop",
  TAKE_PROFIT: "Take Profit",
  TAKE_PROFIT_MARKET: "Take Profit Market"
};
const saveMetaData = (params) => {
  getMetaDataApi().then((data) => {
    const ResponeData = data.data?.metadata;
    const symbol = params.symbol;
    const reqBody = {
      ...ResponeData,
      orderFormData: {
        ...ResponeData?.orderFormData
      }
    };
    reqBody.orderFormData[symbol] = params;
    postMetaDataApi(JSON.stringify(reqBody));
  });
};
const placeStrategyOrders = (orderDetails, dispatch, navigationCallback, setShowLoader, setOrderConfirm, setOrderStatus, setOrderErrors) => {
  placeOCOOrderApi({ orders: orderDetails, type: "OTOCO" })
    .then((response) => {
      if (response?.data?.errors && response?.data?.errors?.length > 0) {
        setOrderStatus("failed");
        const errrorArr = [];
        response.data?.errors.map((err) => {
          errrorArr.push(err.message);
          dispatch(
            showSnackBar({
              src: ORDER_CREATION_TP_SL_FAIL,
              message: err.message,
              type: "failure"
            })
          );
        });
        setOrderErrors(errrorArr);

        // setIsOrderConfirmedModal(false);
      }
      if (response?.data?.orders?.length > 0) {
        setOrderStatus("success");
        response.data.orders.map((order) =>
          dispatch(
            showSnackBar({
              src: ORDER_CREATION_TP_SL_SUCESS,
              message: `Your ${MapOrder[order?.type]} order has been created successfully`,
              type: "success"
            })
          )
        );
        setShowLoader(false);
        setOrderConfirm(false);
        navigationCallback(1);
        dispatch({
          type: DENSITY_WS_SUBSCRIBE_CREATE_ORDER,
          payload: {
            data: [response.data.orders[0]],
            type: orderDetails[0].type,
            eventType: "CREATE_ORDER"
          }
        });

        // saveMetaData(orderFormMetaData);
        // setIsOrderConfirmedModal(false);
      }
    })
    .catch((err) => {
      dispatch(
        showSnackBar({
          src: ORDER_CREATION_TP_SL_FAIL,
          message: err.message,
          type: "failure"
        })
      );
      setOrderStatus("failed");
      setShowLoader(false);
      // setIsOrderConfirmedModal(false);
    });
};

// PERPIFY testnet: place orders over the account WebSocket to the engine (no REST order
// endpoint). Market = marketable IOC that crosses the book (±5% acts as a slippage cap);
// Limit = GTC resting order. Fills, positions and balance come back over the same socket
// as ORDER_TRADE_UPDATE / ACCOUNT_UPDATE. TP/SL bracket and stop-trigger orders are not on
// testnet yet, so they're declined cleanly rather than silently dropped.
export const PERPIFY_PLACE_ORDER = "PERPIFY_PLACE_ORDER";
export const PERPIFY_PLACE_TRIGGER = "PERPIFY_PLACE_TRIGGER";

// PERPIFY testnet order types: 0 market, 1 limit, 2 stop-market (trigger), 3 stop-limit.
// Market/Limit fill against the book now; Stop types arm an engine trigger that fires when
// the mark crosses. TP/SL brackets arm reduce-only triggers that close the position on cross.
// triggerAbove = target >= reference works for every case (buy/sell, TP/SL, entry stops).
const placePerpifyOrder = (params, dispatch, setShowLoader, setOrderConfirm, navigationCallback, setOrderStatus, setOrderErrors) => {
  const fail = (message) => {
    setOrderStatus("failed");
    setOrderErrors(message);
    setShowLoader(false);
    setOrderConfirm(false);
    dispatch(showSnackBar({ src: ORDER_CREATION_FAIL, message, type: "failure" }));
  };

  const side = params.side === "BUY" ? "buy" : "sell";
  const closeSide = side === "buy" ? "sell" : "buy";
  const qty = Number(params.quantity);
  const ref = Number(params.lastTradedPrice) || Number(params.price) || Number(params.stopPrice) || 0;
  if (!(qty > 0)) return fail("Enter a valid size.");

  const baseId = `ui-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const armTrigger = (suffix, tside, triggerPx, reduceOnly, limitPx) =>
    dispatch({
      type: PERPIFY_PLACE_TRIGGER,
      payload: {
        type: "place_trigger",
        id: baseId + suffix,
        symbol: params.symbol,
        side: tside,
        qty,
        triggerPx: Number(Number(triggerPx).toFixed(2)),
        triggerAbove: Number(triggerPx) >= ref,
        limitPx: limitPx ? Number(Number(limitPx).toFixed(2)) : 0,
        reduceOnly
      }
    });

  if (params.type === 2 || params.type === 3) {
    // stop-market / stop-limit ENTRY → arm a trigger that fires when the mark reaches stopPrice
    const stopPx = Number(params.stopPrice);
    if (!(stopPx > 0)) return fail("Enter a valid trigger price.");
    if (params.type === 3 && !(Number(params.price) > 0)) return fail("Enter a valid limit price.");
    armTrigger("", side, stopPx, !!params.reduceOnly, params.type === 3 ? params.price : 0);
  } else {
    // market (0) / limit (1) main order — fills against the book
    let price;
    let tif;
    if (params.type === 0) {
      if (!(ref > 0)) return fail("No market price yet — try again in a moment.");
      price = side === "buy" ? ref * 1.05 : ref * 0.95; // cross the book (5% slippage cap)
      tif = "IOC";
    } else {
      price = Number(params.price);
      tif = "GTC";
    }
    if (!(price > 0)) return fail("Enter a valid price.");
    const px = Number(price.toFixed(2));
    // Real EIP-712 signing path (auth-v1): only for a connected real wallet with an injected
    // signer, and only when the flag is on. The demo burner has no injected signer, so it always
    // takes the plain testnet path below — the live demo is untouched.
    if (FEATURES.signedOrders && isRealWallet() && hasInjectedSigner()) {
      const owner = getWallet();
      const canonical = {
        owner,
        market: params.symbol,
        side,
        qty8: BigInt(Math.round(qty * 1e8)),
        price8: BigInt(Math.round(px * 1e8)),
        tif,
        reduceOnly: !!params.reduceOnly,
        nonce: nextNonce(owner),
        expiry: 0n
      };
      signOrder(canonical)
        .then((sig) => dispatch({ type: "PERPIFY_PLACE_ORDER_SIGNED", payload: toWirePayload(canonical, sig, baseId) }))
        .catch(() => dispatch(showSnackBar({ src: ORDER_CREATION_FAIL, message: "Signature declined — order not placed.", type: "failure" })));
    } else {
      dispatch({
        type: PERPIFY_PLACE_ORDER,
        payload: { type: "place_order", id: baseId, symbol: params.symbol, side, qty, price: px, tif, reduceOnly: !!params.reduceOnly }
      });
    }
  }

  // TP / SL brackets: reduce-only closes armed alongside the entry
  if (params.takeProfitEnabled && Number(params.takeProfit) > 0) armTrigger("-tp", closeSide, params.takeProfit, true, 0);
  if (params.stopLossEnabled && Number(params.stopLoss) > 0) armTrigger("-sl", closeSide, params.stopLoss, true, 0);

  // Optimistic: fills / open-order / balance updates arrive over the account WS.
  setShowLoader(false);
  setOrderConfirm(false);
  setOrderStatus("success");
  navigationCallback(params.type);
  const label = params.type === 0 ? "Market order sent" : params.type === 1 ? "Limit order placed" : "Stop order armed";
  const bracket = params.takeProfitEnabled || params.stopLossEnabled ? " · TP/SL armed" : "";
  dispatch(showSnackBar({ src: ORDER_CREATION_SUCESS, message: label + bracket, type: "success" }));
};

export const createOrder = (params, dispatch, setShowLoader, setOrderConfirm, navigationCallback, setOrderStatus, setOrderErrors) => {
  setShowLoader(true);
  // TP/SL brackets + stop orders are supported via the engine's conditional-order triggers.
  placePerpifyOrder(params, dispatch, setShowLoader, setOrderConfirm, navigationCallback, setOrderStatus, setOrderErrors);
};

const returnOrderType = (params) => {
  if (params.type === 0) return "MARKET";
  if (params.type === 1) return "LIMIT";
  // Stop Market
  if (params.type === 2) {
    if (params.side === "BUY") {
      if (Number(params.stopPrice) < Number(params.lastTradedPrice)) {
        return "TAKE_PROFIT_MARKET";
      } else {
        return "STOP_MARKET";
      }
    } else if (params.side === "SELL") {
      if (Number(params.stopPrice) > Number(params.lastTradedPrice)) {
        return "TAKE_PROFIT_MARKET";
      } else {
        return "STOP_MARKET";
      }
    }
  }
  // Stop Limit
  if (params.type === 3) {
    if (params.side === "BUY") {
      if (Number(params.stopPrice) < Number(params.lastTradedPrice)) {
        return "TAKE_PROFIT";
      } else {
        return "STOP";
      }
    } else if (params.side === "SELL") {
      if (Number(params.stopPrice) > Number(params.lastTradedPrice)) {
        return "TAKE_PROFIT";
      } else {
        return "STOP";
      }
    }
  }
};
