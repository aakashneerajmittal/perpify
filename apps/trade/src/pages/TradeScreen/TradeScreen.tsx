import React, { memo, useEffect, useState } from "react";
import OrderFormWrapper from "@/components/Home/OrderForm/OrderFormWrapper";
import { useDispatch, useSelector } from "react-redux";
import MarketSegment from "@/components/Home/TradeSymbolData/MarketSegment/MarketSegment";
import { UserActivities } from "@/components/Home/UserActivities";
import { Box, useMediaQuery } from "@mui/material";
import MobileTradeScreen from "../MobileView/TradeScreen/MobileTradeScreen";
// PERPIFY: market data now comes from the Perpify engine, not Binance.
import usePerpifyMarketData from "@/frontend-BL/businessHooks/BINANCE_WORKER/usePerpifyMarketData";
import { useNavigate } from "react-router-dom";
import TradeSymbolData from "@/components/Home/TradeSymbolData/TradeSymbolData";
import Loader from "@/helpers/Loader";
function TradeScreen() {
  // const { opened } = useSelector((state: any) => state.wsConnection.binance);
  const [showOrderForm, setShowOrderForm] = useState({
    expand: false,
    side: "BUY"
  });
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: "RESUME_RENDERING" });
  }, []);
  usePerpifyMarketData({ tradeScreen: true });
  const navigate = useNavigate();
  useEffect(() => {
    const showOrderForm = JSON.parse(localStorage.getItem("showOrderForm"));
    const referralDone = localStorage.getItem("isReferralDone");
    if (referralDone !== null || referralDone === true || referralDone === "true") {
      navigate("/referral");
    }
    if (!showOrderForm) {
      setShowOrderForm({ expand: false, side: "BUY" });
    }
  }, []);

  const isLargeScreen = useMediaQuery("(min-width:768px)");

  return (
    <>
      {/* {!opened && (
      <Box bgcolor={"background.primary"} mx={"1px"} sx={{ height: "100%", display: "flex", alignItems: "center" }}>
        <Loader customObject={{ width: "30px", margin: "auto" }} circular={true} />
      </Box>
    )} */}
      {/* {  opened &&<> */}

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",

          height: "calc(100% - 60px)"
        }}
      >
        <MarketSegment showOrderForm={showOrderForm} setShowOrderForm={setShowOrderForm} />

        <Box sx={{ display: "flex", gap: 0.5, height: "calc(100% - 60px)" }}>
          <TradeSymbolData />
          {isLargeScreen && !showOrderForm.expand && <OrderFormWrapper Side={showOrderForm.side} />}
        </Box>
      </Box>
      <Box mt={0.5}>
        {!isLargeScreen && <MobileTradeScreen />}
        {isLargeScreen && <UserActivities />}
      </Box>
      {/* </>} */}
    </>
  );
}

export default memo(TradeScreen);
