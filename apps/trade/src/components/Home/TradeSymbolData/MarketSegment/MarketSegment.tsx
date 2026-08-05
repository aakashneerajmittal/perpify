// React hooks
import React from "react";
import { numberWithCommas } from "@/helpers/commaHelper";
import { SymbolPrecisionHelper } from "@/helpers";

// MUI
import { Box, Tabs, Tooltip, useMediaQuery } from "@mui/material";
import { Mark, twentyfourHr_change, Funding_Countdown, _24hrVolume, _24HighLow } from "./MarketSegmentObject";
import MarkPrice from "./MarkPrice";
import Funding from "./Funding";
import DayData from "./DayData";
import Change24 from "./Change24";
import LastTradedPrice from "@/components/LastTradedPrice/LastTradedPrice";
import { useSelector } from "react-redux";
import TextView from "@/components/UI/TextView/TextView";
import { FundingRateToolTip, MarkPriceToolTip } from "@/assets/strings/tooltip.string";
import SideMenu from "@/components/Home/SideMenu/SideMenu";
import GapCoefficient from "./GapCoefficient";
import ReduceOnlyChip from "./ReduceOnlyChip";
import ConnectButton from "@/components/Wallet/ConnectButton";
import PassportChip from "./PassportChip";
import { Logo } from "@/components/UI/Logo";
const MarketSegment = () => {
  const symbol = useSelector((state: any) => state.selectSymbol.selectedSymbol);
  const isLargeScreen = useMediaQuery("(min-width:768px)");
  const { setDecimalPrecision, symbolPricePrecision } = SymbolPrecisionHelper({
    symbol
  });
  const marketSegmentData = () => (
    <Box sx={{ overflow: "auto", width: "100%", backgroundColor: "neutral.grey2" }}>
      <Tabs
        sx={{
          height: "100%",
          ".MuiTabScrollButton-root:hover": {
            backgroundColor: "background.secondary"
          },
          ".MuiTabScrollButton-root": {
            height: "100%",
            width: { sx: "20px", xs: "6px" },
            ".MuiSvgIcon-root: hover": { color: "text.main" },
            ".MuiTabs-flexContainer ": {
              gap: "10px"
            }
          },
          display: "flex",
          alignItems: "center",
          gap: { sm: 1, xs: 0.5 }
        }}
        variant="scrollable"
        scrollButtons
        allowScrollButtonsMobile
        aria-label="scrollable force tabs example"
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5
          }}
        >
          <Box
            sx={{
              minWidth: { sm: "110px", xs: "80px" },
              textAlign: { sm: "center", xs: "start" }
            }}
          >
            <LastTradedPrice
              id={"market-segment-ltp"}
              symbol={symbol}
              symbolPricePrecision={symbolPricePrecision}
              variant="SemiBold_16"
              contextListner="market"
              convertToPrecisionValueForPrice={setDecimalPrecision}
            />
          </Box>

          <Box
            sx={{
              minWidth: { sm: "110px", xs: "80px" }
            }}
          >
            {" "}
            <Tooltip
              componentsProps={{
                tooltip: {
                  sx: {
                    color: "#ffff",
                    fontSize: "11px",
                    backgroundColor: "background.tertiary",
                    fontWeight: 600,
                    p: "10px"
                  }
                }
              }}
              arrow
              placement="bottom"
              title={<TextView text={MarkPriceToolTip} />}
            >
              <TextView text={Mark} component="h5" variant="Medium_11" color={"text.regular"} />
            </Tooltip>
            <MarkPrice symbolPricePrecision={symbolPricePrecision} variant={"Medium_12"} setDecimalPrecision={setDecimalPrecision} symbol={symbol} styles={{}} />
          </Box>
          <Box
            sx={{
              minWidth: "80px"
            }}
          >
            <TextView component={"h5"} variant={"Medium_11"} color={"text.regular"} text={twentyfourHr_change} />

            <Change24 symbol={symbol} />
          </Box>
          <Box
            sx={{
              minWidth: { sm: "110px", xs: "80px" }
            }}
          >
            <TextView component={"h5"} text={_24HighLow} variant="Medium_11" color={"text.regular"} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <DayData contextListner="market" color={"text.success"} symbolPricePrecision={symbolPricePrecision} setDecimalPrecision={setDecimalPrecision} symbol={symbol} type={"DAY_HIGH"} />
              <TextView component={"p"} variant="Regular_11" text={" / "} />

              <DayData contextListner="market" color={"text.error"} symbolPricePrecision={symbolPricePrecision} setDecimalPrecision={setDecimalPrecision} symbol={symbol} type={"DAY_LOW"} />
            </Box>
          </Box>
          <Box
            sx={{
              minWidth: { sm: "110px", xs: "80px" }
            }}
          >
            <TextView component="h5" text={_24hrVolume} variant="Medium_11" color={"text.regular"} />

            <DayData contextListner="market" setDecimalPrecision={numberWithCommas} symbol={symbol} type={"DAY_VOLUME"} />
          </Box>
          <Box
            sx={{
              minWidth: { sm: "110px", xs: "80px" }
            }}
          >
            <Tooltip
              componentsProps={{
                tooltip: {
                  sx: {
                    color: "#ffff",
                    fontSize: "11px",
                    backgroundColor: "background.tertiary",
                    fontWeight: 600,
                    p: "10px"
                  }
                }
              }}
              arrow
              placement="bottom"
              title={<TextView text={FundingRateToolTip} />}
            >
              <TextView component={"h5"} variant={"Medium_11"} color={"text.regular"} text={Funding_Countdown} />
            </Tooltip>
            <Funding contextListner="market" symbol={symbol} />
          </Box>
          <GapCoefficient />
          <ReduceOnlyChip />
        </Box>
      </Tabs>
    </Box>
  );
  return (
    <Box
      sx={{
        backgroundColor: "background.primary",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0
      }}
    >
      {/* Header row — brand + account, like the top nav on Binance / Coinbase. Keeps the
          ticker line below it uncluttered. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          height: "44px",
          px: 1,
          borderBottom: "1px solid",
          borderColor: "background.tertiary"
        }}
      >
        <Logo withName={true} style={{ fontSize: "18px" }} />
        {isLargeScreen && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <PassportChip />
            <ConnectButton />
          </Box>
        )}
      </Box>

      {/* Ticker row — symbol selector + live market stats. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          height: "52px",
          p: { xs: 0.5 }
        }}
      >
        <SideMenu />
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>{marketSegmentData()}</Box>
      </Box>
    </Box>
  );
};
export default MarketSegment;
