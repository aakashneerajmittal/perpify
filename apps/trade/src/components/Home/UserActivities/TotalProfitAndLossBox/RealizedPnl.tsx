/**
 * RealizedPnl — lifetime realized PnL across all closed positions, streamed by the engine's
 * realized-PnL ledger on ACCOUNT_UPDATE (accumulatedRealized) and stored in accountInfo.
 * Sits next to the (unrealized) Total P&L so a trader sees both what's open and what they've
 * actually banked. Hidden until the account stream has populated.
 */
import React from "react";
import { useSelector } from "react-redux";
import { Box } from "@mui/material";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const RealizedPnl = () => {
  const info = useSelector((s: any) => s?.futures?.accountInfo);
  const realized = Number(info?.totalRealizedProfit);
  if (!Number.isFinite(realized)) return null;
  const color = realized > 0 ? "#26a69a" : realized < 0 ? "#ef5350" : "#8a8a82";
  return (
    <Box sx={{ mt: "2px", display: "flex", alignItems: "baseline", gap: "6px" }}>
      <Box sx={{ fontSize: 10, letterSpacing: "0.04em", color: "#6f6f68", textTransform: "uppercase" }}>Realized</Box>
      <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 12, color }}>
        {realized >= 0 ? "+" : ""}
        {realized.toFixed(2)} USDC
      </Box>
    </Box>
  );
};

export default RealizedPnl;
