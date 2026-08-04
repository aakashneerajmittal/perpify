import { FETCH_PNL_HISTORY, FETCH_PNL_TRADES } from "@/frontend-api-service/URI";
import { Format } from "@/helpers";
import axiosWithApiServer from "@/frontend-api-service/Utils/axiosHelpers/axiosWithApiServer";
import { getOrderSide } from "@/helpers/orderHistoryApiParams";
import { useCallback } from "react";
import store from "@/frontend-BL/redux/store/configureStore";

export const fetchPnLHistory = ({ start, size, symbol = "", startTime = "", endTime = "", side = "" }) => {
  symbol = symbol === "Symbol" ? "" : symbol;
  side = getOrderSide(side);

  const url = Format(FETCH_PNL_HISTORY.url, start, size, symbol, startTime, endTime, side);

  return axiosWithApiServer({ url, method: FETCH_PNL_HISTORY.reqType })
    .then((res) => {
      return res.data ?? [];
    })
    .catch((err) => {
      throw new Error(err?.response?.data?.details);
    });
};

// PERPIFY: the "See Details" trade breakdown reads from the WS-accumulated order history
// (perpifyHistory) instead of the REST trades endpoint the engine doesn't serve. Returns the
// fills for this order id as { order: { symbol, createdAt, updatedAt, trades:[...] } } — the
// shape PnLOrderSummaryModal renders (trades' realizedPnl/commission/qty are numbers).
export const FETCH_TRADES = (id) => {
  const records = (store.getState().perpifyHistory && store.getState().perpifyHistory.records) || [];
  const fills = records.filter((r) => r.orderId === id && r.status !== "CANCELED");
  const trades = fills.map((r) => ({
    tradeId: r.orderId,
    ID: r.orderId,
    symbol: r.symbol,
    side: r.side,
    price: Number(r.price) || 0,
    qty: Number(r.qty) || 0,
    realizedPnl: Number(r.realizedPnl) || 0,
    commission: Number(r.fee) || 0,
    maker: false,
    tradeTime: r.time
  }));
  const first = fills[0] || {};
  const last = fills[fills.length - 1] || first;
  const order = {
    symbol: first.symbol || "",
    createdAt: first.time || last.time || 0,
    updatedAt: last.time || first.time || 0,
    trades
  };
  return Promise.resolve({ order });
};
