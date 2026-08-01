import { getLastTradedPrice, getMarkPrice, getOrderBook } from "@/frontend-api-service/Api/SnapShot";

import { SET_MARK_PRICE_DATA, SET_TICKER_DATA } from "../../constants/Constants";

export const getMarkPriceSnapShot = (symbol) => (dispatch) => {
  getMarkPrice(symbol).then((response) => {
    const sData = response.data;
    const markPriceDataModal = {
      symbol: sData.symbol,
      markprice: sData.markPrice,
      indexPrice: sData.indexPrice,
      fundingRate: sData.lastFundingRate,
      countDown: sData.time
    };
    dispatch({
      type: SET_MARK_PRICE_DATA,
      payload: markPriceDataModal
    });
  });
};
export const getLastTradedPriceSnapShot = (symbol) => (dispatch) => {
  getLastTradedPrice(symbol).then((response) => {
    const sData = response.data;
    const ltp = {
      change24hHigh: "",
      change24hLow: "",
      volume24h: "",
      change24h: "",
      change24hpercent: "",
      symbol: sData.symbol,
      ltp: sData.price
    };
    dispatch({ type: SET_TICKER_DATA, payload: ltp });
  });
};

export const getOrderBookSnapShot = (symbol) => (dispatch) => {
  dispatch({
    type: "SET_ORDER_BOOK_LOADING",
    payload: symbol
  });
  getOrderBook(symbol).then((res) => {
    dispatch({
      type: "SET_ORDER_BOOK_BINANCE",
      payload: { ...res.data, symbol }
    });
  });
};
