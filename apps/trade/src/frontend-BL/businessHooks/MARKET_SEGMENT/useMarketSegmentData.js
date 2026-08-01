// React hooks
import { useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
// third party packages
import moment from "moment";
// Apis
import { openInterestApi, _24hrTicker } from "../../../frontend-api-service/Api";
// Actions
import { getOpenInterest } from "../../redux/actions/Futures/GetOpenInterest.ac";
// Constant
import { SET_TICKER_DATA } from "../../redux/constants/Constants";
// Sockets
import { SetAggTradeStatus } from "../../redux/actions/User/SetAggTradeStatus.ac";
import SetSelectedSymbolHelper from "../../..//helpers/SetSelectedSymbolHelper";

export const useMarketSegmentData = () => {
  const COLOR_INDICATOR = {
    green: "#28b67e",
    red: "#f46251"
  };

  const selectedOption = useSelector((state) => state.selectSymbol.selectedSymbol);
  const setMarkPrice = useSelector((state) => state.BinanceStreamData.markPrice);
  const setTickerData = useSelector((state) => state.BinanceStreamData.ticker);
  const activeSymbols = useSelector((state) => state.activeSymbolData.activeSymbols);
  const selectedSymbolStats = activeSymbols.filter((symbolFromServer) => symbolFromServer.symbol === selectedOption.toUpperCase())[0];

  const isloading = useRef(true);
  const openInterest = useRef("");
  const currentTime = useRef(moment());
  const LastPrice = useRef("");
  const colorIndicator = useRef(0);
  const previousLastTradedPrice = useRef(0);
  const dispatch = useDispatch();

  const aggTrade = useMemo(() => {
    const ltpData = setTickerData.find((ltpData) => ltpData.symbol === selectedOption.toUpperCase());
    if (ltpData?.ltp !== undefined) {
      dispatch(SetAggTradeStatus({ payload: true }));
      return ltpData?.ltp;
    } else {
      dispatch(SetAggTradeStatus({ payload: false }));
      return "-";
    }
  }, [setTickerData, selectedOption]);
  useEffect(() => {
    if (aggTrade) {
      if (previousLastTradedPrice.current === 0) {
        previousLastTradedPrice.current = aggTrade;
      }
      parseFloat(aggTrade) - parseFloat(previousLastTradedPrice.current) > 0
        ? (colorIndicator.current = 1)
        : parseFloat(aggTrade) - parseFloat(previousLastTradedPrice.current) < 0
        ? (colorIndicator.current = -1)
        : (colorIndicator.current = 0);
      previousLastTradedPrice.current = aggTrade;
    }
  }, [aggTrade]);

  const marketSegment = useMemo(() => {
    const mpData = setMarkPrice.find((mpData) => mpData.symbol === selectedOption.toUpperCase());
    if (mpData !== undefined) {
      isloading.current = false;
      return mpData;
    }
  }, [setMarkPrice, selectedOption]);

  const changemarketSegment = useMemo(() => {
    const tickerDataIndex = setTickerData.findIndex((tData) => tData.symbol === selectedOption.toUpperCase());
    if (tickerDataIndex !== -1) {
      isloading.current = false;
      return setTickerData[tickerDataIndex];
    }
  }, [setTickerData]);

  const getOpenInterestValue = (selectValue) => {
    openInterestApi(selectValue)
      .then((successResponse) => {
        openInterest.current = successResponse.data.openInterest;
        dispatch(getOpenInterest(true, successResponse.data));
      })
      .catch((error) => {
        getOpenInterest(false, error);
      });
  };

  const get24HrTickerValue = (selectValue) => {
    _24hrTicker(selectValue)
      .then((successResponse) => {
        const ltp = {
          change24hHigh: successResponse.data.highPrice,
          change24hLow: successResponse.data.lowPrice,
          volume24h: successResponse.data.volume,
          change24h: successResponse.data.priceChange,
          change24hpercent: successResponse.data.priceChangePercent,
          symbol: successResponse.data.symbol,
          ltp: successResponse.data.lastPrice
        };
        dispatch({ type: SET_TICKER_DATA, payload: ltp });
        LastPrice.lastprice = successResponse.data.lastPrice;
      })
      .catch((error) => {
        console.error(error);
      });
  };

  useEffect(() => {
    if (selectedOption) {
      getOpenInterestValue(selectedOption || SetSelectedSymbolHelper());
      get24HrTickerValue(selectedOption || SetSelectedSymbolHelper());
    }
  }, [selectedOption]);

  const targetTime = useMemo(() => {
    if (marketSegment !== undefined && Object.keys(marketSegment).length > 0) {
      return moment(marketSegment.countDown);
    }
  }, [marketSegment]);
  const timeBetween = useMemo(() => {
    if (targetTime !== undefined && Object.keys(targetTime).length > 0) {
      return moment.duration(targetTime.diff(currentTime.current));
    }
  }, [targetTime]);

  useEffect(() => {
    const interval = setInterval(() => {
      currentTime.current = moment();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // TODO : Move color controlling to jsx component
  const Change24hGenerator = useMemo(() => {
    if (!changemarketSegment && selectedSymbolStats) {
      if (parseFloat(selectedSymbolStats.percentage) >= 0) {
        return {
          indicator: COLOR_INDICATOR.green,
          priceChange: selectedSymbolStats.priceChange,
          percentageChange: selectedSymbolStats.percentage
        };
      } else {
        return {
          indicator: COLOR_INDICATOR.red,
          priceChange: selectedSymbolStats.priceChange,
          percentageChange: selectedSymbolStats.percentage
        };
      }
    }
    if (changemarketSegment !== undefined) {
      if (changemarketSegment.change24hpercent.toString().charAt(0) === "-") {
        return {
          indicator: COLOR_INDICATOR.red,
          priceChange: changemarketSegment.change24h,
          percentageChange: changemarketSegment.change24hpercent
        };
      } else {
        return {
          indicator: COLOR_INDICATOR.green,
          priceChange: changemarketSegment.change24h,
          percentageChange: changemarketSegment.change24hpercent
        };
      }
    }
  }, [changemarketSegment, activeSymbols]);

  const markPrice = useMemo(() => {
    if (marketSegment !== undefined) {
      return marketSegment.markprice;
    }
  }, [marketSegment]);

  const indexPrice = useMemo(() => {
    if (marketSegment !== undefined) {
      return marketSegment.indexPrice;
    }
  }, [marketSegment]);

  const fundingCountDown = useMemo(() => {
    if (marketSegment !== undefined) {
      return (
        (marketSegment.fundingRate * 100).toFixed(4) +
        "%" +
        " / " +
        ("0" + timeBetween.hours()).slice(-2) +
        ":" +
        ("0" + timeBetween.minutes()).slice(-2) +
        ":" +
        ("0" + timeBetween.seconds()).slice(-2)
      );
    }
  }, [marketSegment, timeBetween]);

  const dayHigh = useMemo(() => {
    if (!changemarketSegment) {
      return selectedSymbolStats && selectedSymbolStats.high;
    }
    if (changemarketSegment !== undefined) {
      return changemarketSegment.change24hHigh;
    }
  }, [changemarketSegment, activeSymbols]);

  const dayLow = useMemo(() => {
    if (!changemarketSegment) {
      return selectedSymbolStats && selectedSymbolStats.low;
    }
    if (changemarketSegment !== undefined) {
      return changemarketSegment.change24hLow;
    }
  }, [changemarketSegment, activeSymbols]);

  const dayVolume = useMemo(() => {
    if (!changemarketSegment) {
      return selectedSymbolStats && selectedSymbolStats.vol;
    }
    if (changemarketSegment !== undefined) {
      return changemarketSegment.volume24h ? changemarketSegment.volume24h : 0;
    }
  }, [changemarketSegment, activeSymbols]);

  return {
    Change24hGenerator,
    markPrice,
    indexPrice,
    fundingCountDown,
    dayHigh,
    dayLow,
    dayVolume,
    selectedOption,
    isloading,
    openInterest,
    LastPrice,
    colorIndicator,
    aggTrade
  };
};
