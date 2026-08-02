/**
 * GapCoefficient — Perpify's differentiator on the header. Reads the live gap coefficient
 * that the engine streams (stored as `spx-perp@gapCoefficient` by usePerpifyMarketData) and
 * shows it prominently, turning amber and reading "pricing the dark" when the coefficient is
 * elevated (weekend / dark-period risk being priced in). No other venue shows this.
 */
import React from "react";
import { useSelector } from "react-redux";
import { Box, Tooltip } from "@mui/material";
import TextView from "@/components/UI/TextView/TextView";
import { MONO_FAMILY } from "@/assets/Theme/typography";
import { perpifyWsSend } from "@/frontend-api-service/perpifyWsBridge";
import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";

const GapCoefficient = () => {
  const { isLoggedIn } = useCheckLoginStatus();
  const selectedSymbol = useSelector((state: any) => state?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const gapRaw = useSelector((state: any) => state?.BinanceStreamData?.binanceData?.[`${selectedSymbol.toLowerCase()}@gapCoefficient`]);
  const gap = Number(gapRaw);
  const has = Number.isFinite(gap) && gap > 0;
  const raised = has && gap > 1.005;
  const elevated = has && gap > 1.1; // weekend-preview / genuine weekend
  const color = raised ? "#ffb454" : has ? "#4f8eff" : "text.regular";

  return (
    <Tooltip
      arrow
      placement="bottom"
      componentsProps={{ tooltip: { sx: { color: "#fff", fontSize: "11px", backgroundColor: "background.tertiary", fontWeight: 600, p: "10px", maxWidth: 240 } } }}
      title={
        <TextView
          text={
            "AI gap coefficient — margin is multiplied by this live. 1.00 = market open, continuous. Above 1.00 = the dark period (nights/weekends) is being priced into your margin before the gap, not after."
          }
        />
      }
    >
      <Box sx={{ minWidth: { sm: "120px", xs: "90px" } }}>
        <TextView component={"h5"} variant={"Medium_11"} color={"text.regular"} text={raised ? "Gap Coeff · pricing the dark" : "Gap Coefficient"} />
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
          <TextView component={"p"} variant={"SemiBold_16"} style={{ color, fontFamily: MONO_FAMILY }} text={has ? gap.toFixed(2) : "--"} />
          {has && <TextView component={"p"} variant={"Regular_11"} style={{ color, opacity: 0.7 }} text={"×"} />}
        </Box>
        {isLoggedIn && (
          <Box
            onClick={(e) => {
              e.stopPropagation();
              perpifyWsSend({ type: "demo_weekend", symbol: selectedSymbol });
            }}
            sx={{
              cursor: "pointer",
              fontFamily: MONO_FAMILY,
              fontSize: 8.5,
              letterSpacing: "0.06em",
              color: elevated ? "#ffb454" : "#55554f",
              mt: "1px",
              whiteSpace: "nowrap",
              "&:hover": { color: "#ffb454" }
            }}
          >
            {elevated ? "⚡ weekend · tap live" : "⚡ preview weekend"}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
};

export default GapCoefficient;
