import React, { useMemo } from "react";
import { PropTypes } from "prop-types";
import { Typography } from "@mui/material";
import { useSelector } from "react-redux";
import { MONO_FAMILY } from "@/assets/Theme/typography";
const COLOR_INDICATOR = {
  green: "#28b67e",
  red: "#f46251"
};
const DayLow = ({ symbol, styles }) => {
  // PERPIFY: read the 24h change % from the redux market-data map that usePerpifyMarketData
  // fills from the engine's mark stream (`${sym}@per`). The old Binance web-worker ticker path
  // never fires under Perpify, so this used to read "--" for every market.
  const key = symbol?.toLowerCase();
  const per = useSelector((state) => state.BinanceStreamData.binanceData?.[`${key}@per`]);

  const changemarketSegment = useMemo(() => {
    if (per === undefined || per === null || !Number.isFinite(Number(per))) {
      return { indicator: COLOR_INDICATOR.red, percentageChange: "--" };
    }
    const negative = per.toString().charAt(0) === "-";
    return {
      indicator: negative ? COLOR_INDICATOR.red : COLOR_INDICATOR.green,
      percentageChange: per
    };
  }, [per]);

  return (
    // <Typography component={"p"} sx={styles}>
    <Typography variant={"Medium_12"} component={"h5"} sx={{ ...styles, color: changemarketSegment?.indicator ?? "#2FDAAF", fontFamily: MONO_FAMILY }}>
      {/* {changemarketSegment?.priceChange ?? "--"} */}
      {/* <span style={{ color: "#A9A9A9" }}>{" / "}</span>{" "} */}
      {changemarketSegment?.percentageChange !== undefined ? changemarketSegment?.percentageChange + "%" : "--"}
    </Typography>
    // </Typography>
  );
};
DayLow.propTypes = {
  setDecimalPrecision: PropTypes.func,
  symbol: PropTypes.string,
  styles: PropTypes.object,
  type: PropTypes.string,
  contextListner: PropTypes.string
};
export default DayLow;
