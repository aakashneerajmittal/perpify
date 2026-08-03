/**
 * Portfolio — Perpify testnet portfolio view.
 *
 * The original Density portfolio page rendered analytics cards that fetched REST endpoints the
 * Perpify engine doesn't serve (portfolio dashboard / cumulative-PnL); those calls threw and the
 * whole page came up blank. This is a clean, self-contained replacement built entirely from the
 * redux state the app already streams from the engine — available balance, realized PnL (from the
 * engine's realized-PnL ledger), live unrealized PnL, equity, and the open-positions table — so it
 * always renders and never depends on an unimplemented endpoint.
 */
import React from "react";
import { Box, Grid } from "@mui/material";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const GREEN = "#26a69a";
const RED = "#ef5350";
const MUT = "#8a8a82";

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// defensive field pluck across the shapes the engine / redux may use
const pick = (o: any, keys: string[], d: any = undefined) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return d;
};

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <Box sx={{ background: "#0e0e0e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", p: "16px 20px", minWidth: 190 }}>
    <Box sx={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#55554e" }}>{label}</Box>
    <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 22, mt: "6px", color: color || "#F0EDE8" }}>{value}</Box>
  </Box>
);

const Portfolio = () => {
  const navigate = useNavigate();
  const balance = useSelector((s: any) => num(s?.currentPositions?.crossWalletBalance));
  const realized = useSelector((s: any) => num(s?.futures?.accountInfo?.totalRealizedProfit));
  const positions: any[] = useSelector((s: any) => s?.positionsDirectory?.currentPositions) || [];

  const open = positions.filter((p) => Math.abs(num(pick(p, ["quantity", "positionAmt", "pa", "qty", "size"], 0))) > 0);
  const unrealized = open.reduce((sum, p) => sum + num(pick(p, ["unrealizedProfitAndLoss", "unRealizedPnL", "unRealizedProfit", "up", "pnl", "unrealizedPnl"], 0)), 0);
  const equity = balance + unrealized;

  return (
    <Box sx={{ p: { xs: "1.25rem", md: "2rem 3rem" }, maxWidth: 1100, mx: "auto", width: "100%" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11, letterSpacing: "0.16em", color: "#4F8EFF", textTransform: "uppercase" }}>Perpify · Testnet</Box>
          <Box sx={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", mt: "2px" }}>Portfolio</Box>
        </Box>
        <Box
          onClick={() => navigate("/")}
          sx={{ fontSize: 13, color: "#4F8EFF", cursor: "pointer", borderBottom: "1px solid #4F8EFF", pb: "1px" }}
        >
          Go to trade →
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mt: 3 }}>
        <Stat label="Available balance" value={money(balance)} />
        <Stat label="Account equity" value={money(equity)} />
        <Stat label="Unrealized P&L" value={signed(unrealized)} color={unrealized >= 0 ? GREEN : RED} />
        <Stat label="Realized P&L (lifetime)" value={signed(realized)} color={realized >= 0 ? GREEN : RED} />
        <Stat label="Open positions" value={String(open.length)} />
      </Box>

      <Box sx={{ mt: 4 }}>
        <Box sx={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", mb: 1.5 }}>Open positions</Box>
        <Box sx={{ background: "#0e0e0e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", overflow: "hidden" }}>
          <Grid container sx={{ px: 2, py: 1.2, borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#55554e" }}>
            <Grid item xs={3}>Market</Grid>
            <Grid item xs={2}>Side</Grid>
            <Grid item xs={2.5}>Size</Grid>
            <Grid item xs={2.5}>Entry</Grid>
            <Grid item xs={2}>P&L</Grid>
          </Grid>
          {open.length === 0 ? (
            <Box sx={{ p: 3, textAlign: "center", color: MUT, fontSize: 13 }}>
              No open positions. <span style={{ color: "#4F8EFF", cursor: "pointer" }} onClick={() => navigate("/")}>Open a trade →</span>
            </Box>
          ) : (
            open.map((p, i) => {
              const symbol = pick(p, ["symbol", "s"], "—");
              const qty = num(pick(p, ["quantity", "positionAmt", "pa", "qty", "size"], 0));
              const isLong = qty >= 0;
              const entry = num(pick(p, ["entryPrice", "ep", "entry"], 0));
              const pnl = num(pick(p, ["unrealizedProfitAndLoss", "unRealizedPnL", "unRealizedProfit", "up", "pnl", "unrealizedPnl"], 0));
              return (
                <Grid container key={i} sx={{ px: 2, py: 1.4, borderBottom: i < open.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", fontFamily: MONO_FAMILY, fontSize: 13, alignItems: "center" }}>
                  <Grid item xs={3} sx={{ fontWeight: 700 }}>{String(symbol).replace("-PERP", "")}<span style={{ color: "#55554e", fontSize: 10 }}> PERP</span></Grid>
                  <Grid item xs={2} sx={{ color: isLong ? GREEN : RED }}>{isLong ? "LONG" : "SHORT"}</Grid>
                  <Grid item xs={2.5}>{Math.abs(qty).toLocaleString("en-US", { maximumFractionDigits: 4 })}</Grid>
                  <Grid item xs={2.5}>{entry ? entry.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</Grid>
                  <Grid item xs={2} sx={{ color: pnl >= 0 ? GREEN : RED }}>{signed(pnl)}</Grid>
                </Grid>
              );
            })
          )}
        </Box>
        <Box sx={{ mt: 2, color: "#55554e", fontSize: 11.5, fontFamily: MONO_FAMILY }}>
          Live from the Perpify engine · balances and realized P&L stream over your account socket · testnet, synthetic collateral.
        </Box>
      </Box>
    </Box>
  );
};

export default Portfolio;
