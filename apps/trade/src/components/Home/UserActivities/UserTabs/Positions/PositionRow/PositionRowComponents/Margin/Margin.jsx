import React from "react";
import PropTypes from "prop-types";
import { Typography } from "@mui/material";
import { useSelector } from "react-redux";
import { MONO_FAMILY } from "@/assets/Theme/typography";

function Margin({ setDecimalPrecision, isIsolated, symbol }) {
  const crossWalletDetails = useSelector((state) => state.positionsDirectory.crossWalletDetails.find((data) => data.symbol === symbol));
  const isolatedWallet = useSelector((state) => state.positionsDirectory.isolatedWallet.find((data) => data.sym === symbol));
  return (
    <Typography id="position-margin" textAlign={"left"} component={"p"} variant="medium_12_500" sx={{ fontFamily: MONO_FAMILY }}>
      {!isIsolated ? setDecimalPrecision(crossWalletDetails?.initialMargin, 2) : setDecimalPrecision(isolatedWallet?.isolatedWallet, 2)}
    </Typography>
  );
}

Margin.propTypes = {
  setDecimalPrecision: PropTypes.func,
  isIsolated: PropTypes.bool,
  symbol: PropTypes.string,
  isolatedWallet: PropTypes.number
};

export default Margin;
