/**
 * ReduceOnlyChip — surfaces the venue's oracle-confidence / reduce-only state for the
 * selected market. When confidence drops below threshold (or the demo control forces it),
 * the engine flips the market to reduce-only: new exposure is blocked, closes are allowed.
 * This shows that protection live — the "the venue steps back when it can't trust the feed"
 * story. Hidden when the market is live and confident.
 */
import React from "react";
import { useSelector } from "react-redux";
import { Box, Tooltip } from "@mui/material";
import TextView from "@/components/UI/TextView/TextView";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const ReduceOnlyChip = () => {
  const selectedSymbol = useSelector((state: any) => state?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const key = selectedSymbol.toLowerCase();
  const session = useSelector((state: any) => state?.BinanceStreamData?.binanceData?.[`${key}@session`]);
  const confRaw = useSelector((state: any) => state?.BinanceStreamData?.binanceData?.[`${key}@conf`]);
  if (session !== "reduce-only") return null;
  const conf = Number(confRaw);
  return (
    <Tooltip
      arrow
      placement="bottom"
      componentsProps={{ tooltip: { sx: { color: "#fff", fontSize: "11px", backgroundColor: "background.tertiary", fontWeight: 600, p: "10px", maxWidth: 260 } } }}
      title={<TextView text={"Oracle confidence is low — the venue is in reduce-only mode. You can close positions; opening new exposure is paused until confidence recovers."} />}
    >
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          px: "10px",
          height: 26,
          borderRadius: "6px",
          border: "1px solid rgba(235,182,47,0.5)",
          color: "#EBB62F",
          background: "rgba(235,182,47,0.1)",
          fontFamily: MONO_FAMILY,
          fontSize: 10.5,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        ⚠ Reduce-only{Number.isFinite(conf) && conf > 0 ? ` · conf ${conf.toFixed(2)}` : ""}
      </Box>
    </Tooltip>
  );
};

export default ReduceOnlyChip;
