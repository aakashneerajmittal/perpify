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

const placePerpifyOrder = (params, dispatch, setShowLoader, setOrderConfirm, navigationCallback, setOrderStatus, setOrderErrors) => {
  const fail = (message) => {
    setOrderStatus("failed");
    setOrderErrors(message);
    setShowLoader(false);
    setOrderConfirm(false);
    dispatch(showSnackBar({ src: ORDER_CREATION_FAIL, message, type: "failure" }));
  };

  if (params.type !== 0 && params.type !== 1) {
    return fail("Stop & trigger orders are coming soon on the Perpify testnet.");
  }

  const side = params.side === "BUY" ? "buy" : "sell";
  const qty = Number(params.quantity);
  const ref = Number(params.lastTradedPrice) || Number(params.price) || 0;

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

  if (!(qty > 0) || !(price > 0)) return fail("Enter a valid size and price.");

  const clientId = `ui-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  dispatch({
    type: PERPIFY_PLACE_ORDER,
    payload: {
      type: "place_order",
      id: clientId,
      symbol: params.symbol,
      side,
      qty,
      price: Number(price.toFixed(2)),
      tif,
      reduceOnly: !!params.reduceOnly
    }
  });

  // Optimistic: the fill / open-order / balance updates arrive over the account WS.
  setShowLoader(false);
  setOrderConfirm(false);
  setOrderStatus("success");
  navigationCallback(params.type);
  dispatch(
    showSnackBar({
      src: ORDER_CREATION_SUCESS,
      message: params.type === 0 ? "Market order sent" : "Limit order placed",
      type: "success"
    })
  );
};

export const createOrder = (params, dispatch, setShowLoader, setOrderConfirm, navigationCallback, setOrderStatus, setOrderErrors) => {
  setShowLoader(true);
  if (params.takeProfitEnabled || params.stopLossEnabled) {
    // Bracket (TP/SL / OCO) orders need the engine's conditional-order support (M2).
    setOrderStatus("failed");
    setShowLoader(false);
    setOrderConfirm(false);
    dispatch(
      showSnackBar({
        src: ORDER_CREATION_FAIL,
        message: "Take-profit / stop-loss brackets are coming soon on the Perpify testnet.",
        type: "failure"
      })
    );
    return;
  }
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
