// Not used
import { useEffect, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

import { BINANCE_WS_SUBSCRIBE } from "../../redux/constants/Constants";
import { BINANCE_SUBSCRIBTION_SERVICE, SUB_SRC_MAP } from "../../services/BinanceWebSocketService/Constants";

import { tradesApi } from "../../../frontend-api-service/Api";

export const useTradesData = (symbol) => {
  const dispatch = useDispatch();
  const tradesObject = useRef([]);
  const isloading = useRef(true);
  const localTradesObject = useRef({
    isInitialIteration: true,
    tradesBook: [],
    snapshotTradesObject: [],
    isResponseObtained: false
  });

  let settlementCurrencyType = "";

  const getSymbolList = useSelector((state) => state.tradablesymbolList.tradablesymbolList);
  const selectedSymbol = symbol || window.localStorage.selectedSymbolAuxiliary;

  const binanceWsStatus = useSelector((state) => state.wsConnection.binance.opened);

  const getTime = useCallback((time) => {
    return new Date(time).toLocaleTimeString();
  }, []);

  const filterByReference = useCallback(
    (streamUnderProcess, snapshotArray) => {
      let filteredArray = [];
      filteredArray = snapshotArray[0].filter((trade) => trade.id <= streamUnderProcess.f - 1);
      filteredArray = filteredArray.map((trade) => {
        return { ltp: trade.price, quantity: trade.qty, time: trade.time };
      });
      localTradesObject.current.tradesBook = localTradesObject.current.tradesBook.concat(filteredArray);
    },
    [localTradesObject.current]
  );

  const fetchTrades = useCallback(() => {
    tradesApi(selectedSymbol)
      .then((successResponse) => {
        isloading.current = false;
        localTradesObject.current.snapshotTradesObject.push(successResponse.data);
        localTradesObject.current.isResponseObtained = true;
      })
      .catch((errorMessage) => {
        console.error(errorMessage);
      });
  }, [selectedSymbol]);

  useEffect(() => {
    if (binanceWsStatus) {
      dispatch({
        type: BINANCE_WS_SUBSCRIBE,
        payload: {
          symbol: selectedSymbol,
          // TODO : Move these strings to constants
          methods: [BINANCE_SUBSCRIBTION_SERVICE.ltp],
          source: SUB_SRC_MAP.RT,
          res: ""
        }
      });
    }
    return () => {
      localTradesObject.current = {
        isInitialIteration: true,
        tradesBook: [],
        snapshotTradesObject: [],
        isResponseObtained: false
      };
    };
  }, [selectedSymbol, binanceWsStatus]);

  const streamData = useSelector((state) => state.BinanceStreamData.ltp.find((contract) => contract.symbol === selectedSymbol.toUpperCase()));

  if (getSymbolList.length && selectedSymbol.length) {
    const selectedContract = getSymbolList.filter((contract) => contract.symbol.toLowerCase() === selectedSymbol);
    settlementCurrencyType = selectedContract[0].quoteAsset;
  }

  if (streamData && Object.keys(streamData).length) {
    if (localTradesObject.current.isInitialIteration && selectedSymbol.length) {
      fetchTrades();
      if (localTradesObject.current.isResponseObtained) {
        localTradesObject.current.tradesBook.unshift(streamData);
        filterByReference(streamData, localTradesObject.current.snapshotTradesObject);
        localTradesObject.current.isInitialIteration = false;
        tradesObject.current = localTradesObject.current.tradesBook;
      }
    } else if (!localTradesObject.current.isInitialIteration) {
      localTradesObject.current.tradesBook.unshift(streamData);
      if (localTradesObject.current.tradesBook.length > 25) {
        localTradesObject.current.tradesBook = localTradesObject.current.tradesBook.slice(0, 25);
      }
      tradesObject.current = JSON.parse(JSON.stringify(localTradesObject.current.tradesBook));
    }
  }

  return {
    settlementCurrencyType,
    tradesObject,
    isloading,
    getTime
  };
};
