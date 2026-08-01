import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";
import Loader from "@/helpers/Loader";
import { Box } from "@mui/material";
import React, { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import dataFeed from "./dataFeed";
import { widgetContainer } from "./helpers";
import save_load_adapter from "./saveLoadAdapter";
export const TradingViewChart = ({ ID, res }: { ID: number; res: string }) => {
  const { opened } = useSelector((state: any) => state.wsConnection.binance);
  const selectedSymbol = useSelector((state: any) => state.selectSymbol.selectedSymbol);
  const chartContainerRef = useRef<HTMLDivElement>() as React.MutableRefObject<HTMLInputElement>;
  const { isLoggedIn } = useCheckLoginStatus();
  // PERPIFY: the licensed TradingView Charting Library is not bundled (replaced by a free
  // chart in adoption step 7). Guard its absence so it never crashes the trade screen.
  const hasTV = typeof window !== "undefined" && !!(window as any).TradingView?.widget;
  useEffect(() => {
    if (!hasTV) return;
    let TradingViewWidget: any;
    try {
      const resolution = JSON.parse((window as any).localStorage.getItem("user_pc_resolution_chart_density"))?.resolution ?? 60
      TradingViewWidget = new (window as any).TradingView.widget({
        ...widgetContainer,
        container: chartContainerRef.current,
        interval: res ?? resolution,
        datafeed: dataFeed,
        symbol: selectedSymbol || "BTCUSDT",
        save_load_adapter: isLoggedIn ? save_load_adapter : {},
        client_id: "density.exchange" + { ID }
      });
      if (opened) {
        TradingViewWidget.onChartReady(() => {
          TradingViewWidget.subscribe("onAutoSaveNeeded", () => {
            TradingViewWidget.saveChartToServer(
              () => console.log("Saved"),
              () => console.log("failed to save"),
              {
                defaultChartName: "unnamed"
              }
            );
          });
          TradingViewWidget.chart();
        });
      } else {
        TradingViewWidget.remove();
      }
    } catch (e) {
      // chart lib absent/incompatible — placeholder renders instead
    }

    return () => {
      try { TradingViewWidget?.remove(); } catch (e) {}
    };
  }, [selectedSymbol, ID, opened, isLoggedIn, res, hasTV]);

  return (
    <>
      {!hasTV && (
        <Box bgcolor={"background.primary"} sx={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, color: "text.secondary" }}>
          <Box sx={{ fontFamily: "monospace", fontSize: 13, opacity: 0.7 }}>SPX-PERP · price chart</Box>
          <Box sx={{ fontFamily: "monospace", fontSize: 11, opacity: 0.4 }}>Perpify chart — adoption step 7</Box>
        </Box>
      )}
      {hasTV && !opened && (
        <Box bgcolor={"background.primary"} mx={"1px"} sx={{ height: "100%", display: "flex", alignItems: "center" }}>
          <Loader customObject={{ width: "30px", margin: "auto" }} circular={true} />
        </Box>
      )}
      <div style={{ height: "100%" }} ref={chartContainerRef} ></div>
    </>
  );
};
