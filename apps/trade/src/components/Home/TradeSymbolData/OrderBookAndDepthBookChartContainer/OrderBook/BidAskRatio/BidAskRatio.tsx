import React, { memo, useEffect, useState } from "react";
import { Box } from "@mui/system";
import { useSelector } from "react-redux";
import OuickOrder from "@/components/Home/OrderForm/QuickOrder/OuickOrder";
import TextView from "@/components/UI/TextView/TextView";

const BidAskRatio = () => {
  const [ratio, SetRatio] = useState({ ask: "", bid: "" });
  const [QuickTradeActive, SetQuickTradeActive] = useState(false);
  const symbol = useSelector((state: any) => state.selectSymbol.selectedSymbol);
  // Market Sentiment = live buy/sell pressure from the order book (bid vs ask resting size).
  // The old getQuickOrderDataApi (Density REST longAccount/shortAccount) isn't served by the
  // Perpify engine, so the call always failed and the bar rendered empty "%". Deriving it from
  // the streamed book gives a real, always-available number.
  const orderBook = useSelector((state: any) => state.OrderBook);
  useEffect(() => {
    const sumSize = (levels: any[]) => (levels || []).reduce((t, lvl) => t + (Number(lvl && lvl[1]) || 0), 0);
    const bidVol = sumSize(orderBook?.bids);
    const askVol = sumSize(orderBook?.asks);
    const total = bidVol + askVol;
    if (total > 0) {
      SetRatio({ bid: ((bidVol / total) * 100).toFixed(0), ask: ((askVol / total) * 100).toFixed(0) });
    }
  }, [orderBook, symbol]);
  return (
    <>
      {QuickTradeActive && <OuickOrder SetQuickTradeActive={SetQuickTradeActive} />}
      <Box
        sx={{
          height: "100%",
          display: { sm: "flex", xs: "none" },
          alignItems: "center",
          gap: 1
        }}
      >
        <TextView
          component={"h6"}
          id={"quick-order"}
          onClick={() => SetQuickTradeActive(!QuickTradeActive)}
          style={{
            textDecoration: "underline",
            cursor: "pointer",
            display: { xs: "none", md: "block" }
          }}
          text={"Quick Trade"}
          variant="Medium_12"
        />

        <Box
          sx={{
            display: "flex",
            backgroundColor: "background.primary",
            p: 1,
            gap: 1,
            borderTopRightRadius: "8px",
            borderTopLeftRadius: "8px"
          }}
        >
          <TextView component={"p"} variant="Medium_11" text={"Market Sentiment"} />

          <Box sx={{ display: "flex", flex: 1 }}>
            <TextView />

            <TextView
              variant="Medium_11"
              component={"p"}
              style={{
                px: 1,
                color: "text.success",
                minWidth: "80px",

                textAlign: "left",
                background: "linear-gradient(90deg, #29B57E -234.85%, #0E0E0F 146.96%)"
              }}
              text={`${ratio.bid}%`}
            />
            <TextView
              component={"p"}
              variant="Medium_11"
              text={`${ratio.ask}%`}
              style={{
                px: 1,
                minWidth: "80px",
                textAlign: "right",
                background: "linear-gradient(90deg, rgba(244, 95, 95, 0) -35.92%, rgba(244, 95, 95, 0.3) 100%)",
                color: "text.error"
              }}
            />
          </Box>
        </Box>
      </Box>
    </>
  );
};

export default memo(BidAskRatio);
