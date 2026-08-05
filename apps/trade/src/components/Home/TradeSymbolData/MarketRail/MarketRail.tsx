/**
 * MarketRail — the always-on left column listing every market with live price + 24h change.
 * Reuses Density's existing SideMenuALL/SideMenuRow (already wired to the `activeSymbolData`
 * redux slice and to symbol selection on click), lifted out of the left Drawer into a permanent
 * rail — the "assets on the left" from the Elevated concept. No new data wiring.
 */
import React from "react";
import { Box } from "@mui/material";
import { useSelector } from "react-redux";
import SideMenuALL from "@/components/Home/SideMenu/SideMenuALL";
import TextView from "@/components/UI/TextView/TextView";

const noop = () => {};

const MarketRail: React.FC = () => {
  const selectedCoin = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";

  return (
    <Box
      sx={{
        width: "212px",
        flexShrink: 0,
        height: "100%",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        backgroundColor: "background.primary",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "neutral.grey2" }}>
        <TextView text={"Markets"} variant={"SemiBold_12"} color={"text.regular"} />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 0.5 }}>
        <SideMenuALL tabText={"ALL"} TabsFilter={""} selectedCoin={selectedCoin} SearchSymbol={""} closeDrawer={noop} />
      </Box>
    </Box>
  );
};

export default MarketRail;
