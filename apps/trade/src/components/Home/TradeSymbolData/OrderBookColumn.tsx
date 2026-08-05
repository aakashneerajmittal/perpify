/**
 * OrderBookColumn — the order book surfaced as its own always-on column in the trade screen
 * (previously it was hidden behind the "Chart | Order Book" tab). Renders the real bid/ask
 * ladder in ladder-only mode; the depth chart stays on the dedicated view. "gap-aware" badge
 * ties the book to Perpify's live risk model.
 */
import React from "react";
import { Box } from "@mui/material";
import OrderBookAndDepthBookChartContainer from "./OrderBookAndDepthBookChartContainer/OrderBookAndRecentTradesContainer";
import TextView from "@/components/UI/TextView/TextView";

const OrderBookColumn: React.FC = () => {
  return (
    <Box
      sx={{
        width: "236px",
        flexShrink: 0,
        height: "100%",
        display: { xs: "none", lg: "flex" },
        flexDirection: "column",
        backgroundColor: "background.primary",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid",
          borderColor: "neutral.grey2",
        }}
      >
        <TextView text={"Order Book"} variant={"SemiBold_12"} color={"text.regular"} />
        <Box
          sx={{
            fontSize: "9px",
            fontFamily: "DM Mono, monospace",
            color: "#ffb454",
            border: "1px solid rgba(255,180,84,0.35)",
            borderRadius: "5px",
            px: "6px",
            py: "2px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          gap-aware
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <OrderBookAndDepthBookChartContainer ladderOnly />
      </Box>
    </Box>
  );
};

export default OrderBookColumn;
