/**
 * SymbolSelector — the market switcher in the trade header. Perpify runs six markets
 * (the S&P 500 index perp + the five largest US single-stock perps); this dropdown shows
 * each with its live mark and 24h change (streamed by usePerpifyMarketData, keyed per
 * symbol) and, on pick, sets the selected market so the whole screen — header, order book,
 * chart, gap coefficient, order routing — repoints to it.
 */
import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Box, Menu, MenuItem } from "@mui/material";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { MONO_FAMILY } from "@/assets/Theme/typography";
import { PERPIFY_MARKETS, PERPIFY_MARKET_BY_SYMBOL } from "@/config/perpifySymbol";

const SymbolSelector = () => {
  const dispatch = useDispatch();
  const selected = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const binanceData = useSelector((s: any) => s?.BinanceStreamData?.binanceData);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const meta = PERPIFY_MARKET_BY_SYMBOL[selected] || PERPIFY_MARKETS[0];

  const priceOf = (sym: string): number | null => {
    const p = Number(binanceData?.[`${sym.toLowerCase()}@markPrice@1s`]);
    return Number.isFinite(p) && p > 0 ? p : null;
  };
  const perOf = (sym: string): number | null => {
    const c = Number(binanceData?.[`${sym.toLowerCase()}@per`]);
    return Number.isFinite(c) ? c : null;
  };
  const fmtPrice = (p: number | null) =>
    p == null ? "--" : p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pick = (sym: string) => {
    if (sym !== selected) {
      dispatch({ type: "SET_SELECTED_SYMBOL_SUCCESS", payload: { selectedSymbol: sym } });
      dispatch({ type: "SET_ORDER_BOOK_LOADING", payload: sym });
    }
    setAnchor(null);
  };

  return (
    <>
      <Box
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          pl: 0.5,
          pr: 1,
          py: 0.5,
          borderRadius: "8px",
          cursor: "pointer",
          userSelect: "none",
          minWidth: { sm: 132, xs: 96 },
          transition: "background 0.15s",
          "&:hover": { background: "rgba(255,255,255,0.05)" },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Box sx={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em", color: "#F0EDE8", lineHeight: 1.1 }}>
              {meta.base}
            </Box>
            <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, color: "#6f6f68", letterSpacing: "0.06em" }}>PERP</Box>
          </Box>
          <Box sx={{ fontSize: 10, color: "#8a8a82", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>
            {meta.name}
          </Box>
        </Box>
        <KeyboardArrowDownRoundedIcon sx={{ color: "#8a8a82", fontSize: 20, transform: anchor ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </Box>

      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        MenuListProps={{ sx: { py: 0.5 } }}
        PaperProps={{
          sx: {
            mt: 0.5,
            minWidth: 264,
            background: "#0e0e0e",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          },
        }}
      >
        <Box sx={{ px: 1.5, py: 0.75, fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.14em", color: "#55554f", textTransform: "uppercase" }}>
          Markets · testnet
        </Box>
        {PERPIFY_MARKETS.map((m) => {
          const p = priceOf(m.symbol);
          const c = perOf(m.symbol);
          const up = (c ?? 0) >= 0;
          const isSel = m.symbol === selected;
          return (
            <MenuItem
              key={m.symbol}
              onClick={() => pick(m.symbol)}
              sx={{
                px: 1.5,
                py: 0.9,
                borderLeft: isSel ? "2px solid #4F8EFF" : "2px solid transparent",
                background: isSel ? "rgba(79,142,255,0.08)" : "transparent",
                "&:hover": { background: "rgba(255,255,255,0.05)" },
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 2 }}>
                <Box>
                  <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
                    <Box sx={{ fontWeight: 700, fontSize: 13.5, color: "#F0EDE8" }}>{m.base}</Box>
                    <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 8.5, color: "#6f6f68", letterSpacing: "0.06em" }}>PERP</Box>
                  </Box>
                  <Box sx={{ fontSize: 10.5, color: "#8a8a82" }}>{m.name}</Box>
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 12.5, color: "#F0EDE8" }}>{fmtPrice(p)}</Box>
                  <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 10, color: c == null ? "#55554f" : up ? "#26a69a" : "#ef5350" }}>
                    {c == null ? "--" : `${up ? "+" : ""}${c.toFixed(2)}%`}
                  </Box>
                </Box>
              </Box>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

export default SymbolSelector;
