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

const GapCoefficient = () => {
  const gapRaw = useSelector((state: any) => state?.BinanceStreamData?.binanceData?.["spx-perp@gapCoefficient"]);
  const gap = Number(gapRaw);
  const has = Number.isFinite(gap) && gap > 0;
  const raised = has && gap > 1.005;
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
          <TextView component={"p"} variant={"SemiBold_16"} style={{ color }} text={has ? gap.toFixed(2) : "--"} />
          {has && <TextView component={"p"} variant={"Regular_11"} style={{ color, opacity: 0.7 }} text={"×"} />}
        </Box>
      </Box>
    </Tooltip>
  );
};

export default GapCoefficient;
