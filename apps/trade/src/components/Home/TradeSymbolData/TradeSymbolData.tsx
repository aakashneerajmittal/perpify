import React, { useState, SyntheticEvent } from "react";
import { Box, Tab, TabProps, Tabs, useMediaQuery } from "@mui/material";
import BidAskRatio from "./OrderBookAndDepthBookChartContainer/OrderBook/BidAskRatio/BidAskRatio";
import { styled } from "@mui/material/styles";
import TradingViewChart from "./TradingViewChart/TradingViewChartWrapper";
import TradeNews from "../../News/TradeNews";
import OrderBookAndDepthBookChartContainer from "./OrderBookAndDepthBookChartContainer/OrderBookAndRecentTradesContainer";
import { isEnabled } from "@/config/perpifyFeatures";
type TradeSymbolTabType = "chart" | "orderbook" | "news";

const TabPrimary = styled(Tab)<TabProps>(({ theme }) => ({
  padding: "8px 16px",
  textTransform: "none",
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  color: "text.tertiary",
  fontSize: "12px",
  minHeight: "32px",
  fontFamily: "Neurial-Medium",
  letterSpacing: "0.2px",
  opacity: "unset",

  "&:not(Mui-selected)": {
    color: theme.palette.neutral.grey7
  },
  "&.Mui-selected": {
    color: theme.palette.neutral.black
  }
}));

const TradeSymbolData: React.FC = () => {
  const isLargeScreen = useMediaQuery("(min-width:768px)");
  const [tradeSymbolTabValue, setTradeSymbolTabValue] = useState<TradeSymbolTabType>("chart");
  const tradeSymbolTabs = [
    { id: "1", value: "chart", label: "Chart" },
    // Order Book is now its own always-on column (OrderBookColumn), so it's no longer a tab here.
    // News is kept in code but switched off for the testnet phase (perpifyFeatures.news).
    ...(isEnabled("news") ? [{ id: "3", value: "news", label: "News" }] : [])
  ];

  const handleChange = (event: SyntheticEvent, newValue: TradeSymbolTabType) => {
    setTradeSymbolTabValue(newValue);
  };

  const renderTabsContent = () => {
    if (tradeSymbolTabValue === "chart") {
      return <TradingViewChart fullscreen={false} />;
    } else if (tradeSymbolTabValue === "orderbook") {
      return <OrderBookAndDepthBookChartContainer />;
    } else {
      return (
        <>
          <TradeNews />
        </>
      );
    }
  };

  return (
    <Box sx={{ height: "100%", width: "100%", pt: 0.5 }}>
      <Box
        sx={{
          display: "flex",
          height: "32px",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <Tabs
          sx={{
            minHeight: "32px",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            backgroundColor: "background.primary"
          }}
          value={tradeSymbolTabValue}
          onChange={handleChange}
          id="tradeSymbolTabs"
        >
          {tradeSymbolTabs.map((data) => (
            <TabPrimary id={data.value} value={data.value} label={data.label} key={data.id} />
          ))}
        </Tabs>
        <BidAskRatio />
      </Box>

      {isLargeScreen && (
        <Box
          sx={{
            backgroundColor: "background.primary",
            borderBottomRightRadius: "8px",
            borderBottomLeftRadius: "8px",
            p: 0.5,
            height: `calc(100% - 32px)`
          }}
        >
          {renderTabsContent()}
        </Box>
      )}
      {!isLargeScreen && (
        <Box
          sx={{
            backgroundColor: "background.primary",
            borderRadius: "8px",
            p: 0.5,
            height: [tradeSymbolTabValue === "news" ? "fit-content" : "100%"]
          }}
        >
          {renderTabsContent()}
        </Box>
      )}
    </Box>
  );
};

export default TradeSymbolData;
