import React, { memo, useEffect } from "react";
import OrderFormWrapper from "@/components/Home/OrderForm/OrderFormWrapper";
import { useDispatch } from "react-redux";
import MarketSegment from "@/components/Home/TradeSymbolData/MarketSegment/MarketSegment";
import { UserActivities } from "@/components/Home/UserActivities";
import { Box, useMediaQuery } from "@mui/material";
import MobileTradeScreen from "../MobileView/TradeScreen/MobileTradeScreen";
// PERPIFY: market data now comes from the Perpify engine, not Binance.
import usePerpifyMarketData from "@/frontend-BL/businessHooks/BINANCE_WORKER/usePerpifyMarketData";
import { useNavigate } from "react-router-dom";
import TradeSymbolData from "@/components/Home/TradeSymbolData/TradeSymbolData";
import MarketRail from "@/components/Home/TradeSymbolData/MarketRail/MarketRail";
import OrderBookColumn from "@/components/Home/TradeSymbolData/OrderBookColumn";

function TradeScreen() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: "RESUME_RENDERING" });
  }, []);
  usePerpifyMarketData({ tradeScreen: true });
  const navigate = useNavigate();
  useEffect(() => {
    const referralDone = localStorage.getItem("isReferralDone");
    if (referralDone !== null || referralDone === true || referralDone === "true") {
      navigate("/referral");
    }
  }, []);

  const isLargeScreen = useMediaQuery("(min-width:768px)");

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100% - 60px)"
        }}
      >
        <MarketSegment />

        {/* Elevated layout: [markets rail | chart | order book | order ticket].
            Rail + book are large-screen only; the chart flexes to fill the middle. */}
        <Box sx={{ display: "flex", gap: 0.5, height: "calc(100% - 60px)" }}>
          {isLargeScreen && <MarketRail />}
          <TradeSymbolData />
          {isLargeScreen && <OrderBookColumn />}
          {isLargeScreen && <OrderFormWrapper />}
        </Box>
      </Box>
      <Box mt={0.5}>
        {!isLargeScreen && <MobileTradeScreen />}
        {isLargeScreen && <UserActivities />}
      </Box>
    </>
  );
}

export default memo(TradeScreen);
