import React, { useMemo } from "react";
import { PropTypes } from "prop-types";
import { Typography } from "@mui/material";
import { useSelector } from "react-redux";
import { MONO_FAMILY } from "@/assets/Theme/typography";
const DayLow = ({ symbol, setDecimalPrecision, color, symbolPricePrecision, type }) => {
  // PERPIFY: read the 24h header stats straight from the redux market-data map that
  // usePerpifyMarketData fills from the engine's mark stream (high/low/vol keyed `${sym}@…`).
  // The old Binance web-worker `24hrTicker` path never fires under Perpify, so DayData used to
  // show "--" for every market.
  const key = symbol?.toLowerCase();
  const binanceData = useSelector((state) => state.BinanceStreamData.binanceData);
  const changemarketSegment = useMemo(() => {
    if (!binanceData || !key) return "--";
    const high = binanceData[`${key}@high`];
    const low = binanceData[`${key}@low`];
    const vol = binanceData[`${key}@vol`];
    switch (type) {
      case "DAY_LOW":
        return low !== undefined && Number.isFinite(Number(low)) ? low : "--";
      case "DAY_HIGH":
        return high !== undefined && Number.isFinite(Number(high)) ? high : "--";
      case "DAY_VOLUME":
        return vol ? parseFloat(vol) : 0;
      default:
        return 0;
    }
  }, [binanceData, key, type]);
  return (
    <Typography color={color} component={"h5"} variant={"Medium_12"} sx={{ fontFamily: MONO_FAMILY }}>
      {setDecimalPrecision(changemarketSegment, symbolPricePrecision)}
    </Typography>
  );
};
DayLow.propTypes = {
  setDecimalPrecision: PropTypes.func,
  symbolPricePrecision: PropTypes.string,
  symbol: PropTypes.string,
  color: PropTypes.string,
  contextListner: PropTypes.string,
  type: PropTypes.string
};
export default DayLow;
