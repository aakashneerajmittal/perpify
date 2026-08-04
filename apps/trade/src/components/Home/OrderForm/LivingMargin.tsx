/**
 * LivingMargin — the venue's thesis made visible right where you trade: your margin is not a
 * static number, it's a live AI model output. Renders the engine's initial-margin decomposition
 *
 *     IM = notional × baseIM(33%) × gapCoefficient × tierMultiplier
 *
 * with every factor a live, tappable, explained chip. Purely presentational and additive — it
 * reads values already flowing (order-form size/side from OrderFormContext; the live gap
 * coefficient + last price from the market stream; the trader's behavioral tier from
 * sessionInfo) and changes no order logic. This is what makes the familiar order form read as a
 * new-era exchange instead of another DEX: you see *why* your margin is what it is.
 */
import React, { useContext, useState } from "react";
import { Box, Typography } from "@mui/material";
import { useSelector } from "react-redux";
import OrderFormContext from "./OrderFormNewWrapper";
import { MONO_FAMILY, DISPLAY_FAMILY } from "@/assets/Theme/typography";

const BASE_IM = 0.3333; // engine baseImBps (33%) — Playbook §2.1/§2.2

const num = (x: any) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};
const fmtUsd = (n: number) => {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return n.toFixed(n < 100 ? 2 : 0);
};

type FactorKey = "notional" | "base" | "gap" | "tier";

const LivingMargin: React.FC = () => {
  const { state } = useContext(OrderFormContext) as any;
  const [open, setOpen] = useState<FactorKey | null>(null);

  const selectedSymbol = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const key = selectedSymbol.toLowerCase();
  const gapRaw = useSelector((s: any) => s?.BinanceStreamData?.binanceData?.[`${key}@gapCoefficient`]);
  const lastPx = useSelector((s: any) => s?.BinanceStreamData?.binanceData?.[`${key}@ticker`]);
  const tierMultRaw = useSelector((s: any) => s?.sessionInfo?.tierMult);
  const tier = useSelector((s: any) => s?.sessionInfo?.tier) || null;

  const gap = num(gapRaw) > 0 ? num(gapRaw) : 1.0;
  const tierMult = num(tierMultRaw) > 0 ? num(tierMultRaw) : 1.0;

  // state.size is ALWAYS the contract quantity (base units); sizeToggle only switches the
  // display unit (contracts vs quote), so notional is size × price regardless of the toggle.
  const px = state?.OrderType === 1 && num(state?.limitPrice) > 0 ? num(state.limitPrice) : num(lastPx);
  const sizeNum = num(state?.size);
  const notional = sizeNum * px;

  const im = notional * BASE_IM * gap * tierMult;
  const flat = notional * BASE_IM * 1.0 * 1.0; // a venue that prices everyone the same
  const savePct = Math.round((1 - tierMult) * 100);
  const hasSize = notional > 0;

  const amber = "#ffb454";
  const green = "#3ecf8e";
  const line = "#242420";
  const mut = "#8a8a82";
  const dim = "#55554e";

  const gapNote = gap <= 1.005 ? "1.00× — continuous session" : "pricing the dark before the gap";
  const EXPL: Record<FactorKey, string> = {
    notional: `Notional = size × price = your exposure before any risk pricing.`,
    base: `Base initial margin (33%) — the venue floor every position starts from.`,
    gap: `Gap coefficient ${gap.toFixed(2)}× — Perpify's live model of overnight/weekend gap risk. ${gap <= 1.005 ? "1.00× now (continuous session)." : "Above 1.00 — the dark is priced before the gap, not after."} No other venue shows you this.`,
    tier: `Your behavioral tier ${tier ? tier + " · " : ""}${tierMult}× — earned by how you trade. Discipline posts ${savePct}% less margin. Same ML model as your Trader DNA.`,
  };

  const Factor = ({ k, label, value, color }: { k: FactorKey; label: string; value: string; color?: string }) => (
    <Box
      onClick={() => setOpen(open === k ? null : k)}
      sx={{
        flex: "1 1 auto", minWidth: 0, cursor: "pointer", px: "8px", py: "6px", borderRadius: "8px",
        border: `1px solid ${open === k ? amber : line}`, background: "#131311", transition: ".12s",
        "&:hover": { borderColor: amber },
      }}
    >
      <Typography sx={{ fontSize: "9px", letterSpacing: ".04em", textTransform: "uppercase", color: dim, fontFamily: MONO_FAMILY, whiteSpace: "nowrap" }}>{label}</Typography>
      <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 700, fontSize: "15px", color: color || "#f0ede8", lineHeight: 1.1 }}>{value}</Typography>
    </Box>
  );
  const Mul = () => <Typography sx={{ color: dim, fontWeight: 700, alignSelf: "center", fontSize: "13px" }}>×</Typography>;

  return (
    <Box sx={{ mt: 1, border: `1px solid ${line}`, borderRadius: "11px", p: "11px", background: "radial-gradient(120% 100% at 0% 0%, rgba(255,180,84,.05), transparent)" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography sx={{ fontSize: "9.5px", letterSpacing: ".13em", textTransform: "uppercase", color: dim, fontFamily: MONO_FAMILY }}>Margin — priced live by the model</Typography>
        <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "17px", fontVariantNumeric: "tabular-nums" }}>{hasSize ? "$" + fmtUsd(im) : "—"}</Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "stretch", gap: "5px", mt: "9px" }}>
        <Factor k="notional" label="Notional" value={hasSize ? "$" + fmtUsd(notional) : "—"} />
        <Mul />
        <Factor k="base" label="Base IM" value="33%" />
        <Mul />
        <Factor k="gap" label="Gap" value={gap.toFixed(2) + "×"} color={amber} />
        <Mul />
        <Factor k="tier" label="Tier" value={tierMult + "×"} color={green} />
      </Box>
      <Typography sx={{ fontSize: "11px", color: mut, mt: "9px", lineHeight: 1.45, minHeight: "15px" }}>
        {open ? (
          <span dangerouslySetInnerHTML={{ __html: EXPL[open].replace(/(\d\.\d\d×)/g, '<b style="color:#f0ede8">$1</b>') }} />
        ) : hasSize && savePct > 0 ? (
          <>Every factor is a <b style={{ color: "#f0ede8" }}>live AI output</b> — tap any one. Your tier saves <b style={{ color: green }}>${fmtUsd(flat - im)}</b> vs a venue that prices everyone the same.</>
        ) : (
          <>Every factor is a <b style={{ color: "#f0ede8" }}>live AI output</b>, not a static number — tap any one.</>
        )}
      </Typography>
    </Box>
  );
};

export default React.memo(LivingMargin);
