import React from "react";
import { Grid } from "@mui/material";
import WatchListRevamped from "../WatchListRevamped/WatchListRevamped";
import { TradingViewChart } from "./TradingViewChart/TradingViewChart";

const TradingViewChartWrapper = ({ fullscreen = false }: { fullscreen: boolean }) => {
  return (
    <Grid height="100%" container>
      {!fullscreen && (
        <Grid display={{ xs: "none", sm: "block" }} xs={12} item height={"30px"}>
          <WatchListRevamped />
        </Grid>
      )}
      <Grid xs={12} height={!fullscreen ? "calc(100% - 32px)" : "100%"} item>
        <TradingViewChart fullscreen={fullscreen} />
      </Grid>
    </Grid>
  );
};

export default TradingViewChartWrapper;
