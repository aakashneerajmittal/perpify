/**
 * MarketRail — the always-on left column of markets (symbol · live price · 24h change), the
 * "assets on the left" from the Elevated concept. Custom single-line rows so nothing wraps in the
 * narrow column and the WHOLE row is one click target (the reused drawer row wrapped to two lines
 * in 212px, which made taps miss). Reads the live `activeSymbolData` slice; click selects the
 * market via the same action the rest of the app uses.
 */
import React from "react";
import { Box } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { selectedSymbol as selectSymbolAction } from "@/frontend-BL/redux/actions/Internal/SetSelectedSymbol.ac";
import { getCurrencyUrl, FALLBACK_ICON } from "@/helpers/CurrencyLogo";
import TextView from "@/components/UI/TextView/TextView";

const shortName = (s: string) => String(s).replace(/-PERP$/i, "");
const fmtPx = (n: any) => (n == null || isNaN(Number(n)) ? "--" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const MarketRail: React.FC = () => {
  const dispatch = useDispatch<any>();
  const symbols = useSelector((s: any) => s?.activeSymbolData?.activeSymbols || []);
  const selected = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";

  const rows = [...symbols].sort((a: any, b: any) => (String(a.symbol).toUpperCase() > String(b.symbol).toUpperCase() ? 1 : -1));

  const pick = (sym: string) => {
    dispatch(selectSymbolAction(sym));
    try {
      window.localStorage.selectedSymbolAuxiliary = sym.toLowerCase();
    } catch (e) {
      /* ignore */
    }
  };

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
        {rows.map((r: any) => {
          const sym = r.symbol;
          const on = String(sym).toUpperCase() === String(selected).toUpperCase();
          const pctNum = Number(r.percentage);
          const up = !isNaN(pctNum) ? pctNum >= 0 : true;
          return (
            <Box
              key={sym}
              id={`market-rail-${String(sym).toUpperCase()}`}
              onClick={() => pick(sym)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.25,
                py: "7px",
                cursor: "pointer",
                borderLeft: "2px solid",
                borderColor: on ? "#2ebd85" : "transparent",
                backgroundColor: on ? "rgba(46,189,133,0.07)" : "transparent",
                "&:hover": { backgroundColor: "background.default" },
              }}
            >
              <Box
                component="img"
                src={getCurrencyUrl(shortName(sym).toLowerCase())}
                onError={(e: any) => { e.currentTarget.src = FALLBACK_ICON; }}
                alt=""
                sx={{ width: 18, height: 18, borderRadius: "50%", backgroundColor: "white", flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                <TextView text={shortName(sym)} variant={"Bold_12"} />
              </Box>
              <Box sx={{ textAlign: "right", flexShrink: 0, lineHeight: 1.25 }}>
                <Box sx={{ fontFamily: "DM Mono, monospace", fontSize: "11.5px", color: "#f0ede8" }}>{fmtPx(r.lp)}</Box>
                <Box sx={{ fontFamily: "DM Mono, monospace", fontSize: "10.5px", color: up ? "#2ebd85" : "#f6465d" }}>
                  {isNaN(pctNum) ? "" : `${up ? "+" : ""}${pctNum.toFixed(2)}%`}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default MarketRail;
