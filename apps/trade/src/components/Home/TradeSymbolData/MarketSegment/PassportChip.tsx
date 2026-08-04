/**
 * PassportChip — the trader's behavioral identity in the header, tying who-you-are to
 * what-you-pay. Reads the engine's SESSION_INFO tier (sessionInfo.tier / tierMult / factors)
 * and shows it as a compact "passport" chip; tapping opens a branded panel with the margin
 * discount, the leverage cap, and the named explainability factors the model scored — plus a
 * link to the full Trader DNA. Purely presentational; reads state already in Redux.
 */
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { Box, Dialog, Typography } from "@mui/material";
import { MONO_FAMILY, DISPLAY_FAMILY } from "@/assets/Theme/typography";

const TIER_COLOR: Record<string, string> = { A: "#3ecf8e", B: "#8fbf6f", C: "#ffb454", D: "#ff8a5c", E: "#ff5566" };
const TIER_READ: Record<string, string> = {
  A: "Disciplined — top-tier behavioral underwriting.",
  B: "Consistent — solid risk behavior.",
  C: "Developing — building a track record.",
  D: "Elevated risk — sizing/discipline flags.",
  E: "High risk — repeated risk-behavior flags.",
};

const PassportChip: React.FC = () => {
  const tier = useSelector((s: any) => s?.sessionInfo?.tier) as string | null;
  const tierMult = Number(useSelector((s: any) => s?.sessionInfo?.tierMult)) || 1;
  const maxLeverage = useSelector((s: any) => s?.sessionInfo?.maxLeverage);
  const factors = useSelector((s: any) => s?.sessionInfo?.factors) || [];
  const [open, setOpen] = useState(false);

  const col = tier ? TIER_COLOR[tier] : "#8a8a82";
  const savePct = Math.round((1 - tierMult) * 100);

  return (
    <>
      <Box
        onClick={() => setOpen(true)}
        sx={{
          display: "flex", alignItems: "center", gap: "8px", pl: "5px", pr: "10px", py: "4px",
          border: "1px solid #2f2f28", borderRadius: "999px", cursor: "pointer",
          background: "linear-gradient(180deg,#161512,#0d0d0b)", whiteSpace: "nowrap", minWidth: "fit-content",
          "&:hover": { borderColor: col },
        }}
      >
        <Box sx={{ width: 26, height: 26, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", border: `2px solid ${col}`, color: col, fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "12px" }}>
          {tier || "?"}
        </Box>
        <Box sx={{ lineHeight: 1.1 }}>
          <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "11.5px" }}>
            {tier ? `Tier ${tier}` : "Trader DNA"}
          </Typography>
          <Typography sx={{ fontFamily: MONO_FAMILY, fontSize: "9.5px", color: "#8a8a82" }}>
            {tier ? (savePct > 0 ? `saves ${savePct}% margin →` : "your behavioral tier →") : "get your score →"}
          </Typography>
        </Box>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} PaperProps={{ sx: { background: "#0d0d0d", border: "1px solid #2f2f28", borderRadius: "18px", maxWidth: 460, width: "100%", p: "22px" } }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Typography sx={{ fontSize: "10.5px", letterSpacing: ".14em", textTransform: "uppercase", color: "#55554e", fontFamily: MONO_FAMILY }}>Your Trader DNA · behavioral underwriting</Typography>
          <Box onClick={() => setOpen(false)} sx={{ cursor: "pointer", color: "#8a8a82", fontSize: "18px", lineHeight: 1 }}>✕</Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: "16px", mt: "12px" }}>
          <Box sx={{ width: 62, height: 62, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", border: `4px solid ${col}`, color: col, fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "26px" }}>
            {tier || "?"}
          </Box>
          <Box>
            <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "22px" }}>{tier ? `Tier ${tier}` : "Not yet scored"}</Typography>
            <Typography sx={{ color: "#8a8a82", fontSize: "12.5px", maxWidth: "34ch" }}>{tier ? TIER_READ[tier] : "Connect a wallet or score your history to get a behavioral tier."}</Typography>
          </Box>
        </Box>

        {tier && (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", mt: "18px" }}>
            {[
              { l: "Margin multiplier", v: `${tierMult}×`, s: savePct > 0 ? `${savePct}% less` : "baseline", c: "#3ecf8e" },
              { l: "Leverage cap", v: maxLeverage ? `${maxLeverage}×` : "—", s: "tier-gated", c: "#f0ede8" },
              { l: "Liquidation", v: tier <= "B" ? "Priority" : "Standard", s: "in the reopen", c: "#f0ede8" },
            ].map((k) => (
              <Box key={k.l} sx={{ border: "1px solid #242420", borderRadius: "11px", p: "11px", background: "#131311" }}>
                <Typography sx={{ fontSize: "9.5px", letterSpacing: ".05em", textTransform: "uppercase", color: "#55554e" }}>{k.l}</Typography>
                <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "20px", color: k.c }}>{k.v}</Typography>
                <Typography sx={{ fontSize: "10.5px", color: "#8a8a82" }}>{k.s}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {tier && factors.length > 0 && (
          <Box sx={{ mt: "16px" }}>
            <Typography sx={{ fontSize: "10.5px", letterSpacing: ".1em", textTransform: "uppercase", color: "#55554e", mb: "8px" }}>What the model scored</Typography>
            {factors.slice(0, 5).map((f: any, i: number) => {
              const pos = Number(f.contribution) >= 0;
              const w = Math.min(100, Math.abs(Number(f.contribution)) * 100);
              return (
                <Box key={i} sx={{ display: "flex", alignItems: "center", gap: "10px", py: "5px" }}>
                  <Typography sx={{ fontSize: "12px", width: "48%", color: "#f0ede8" }}>{String(f.name).replace(/-/g, " ")}</Typography>
                  <Box sx={{ flex: 1, height: 6, borderRadius: 3, background: "#1b1b18", overflow: "hidden" }}>
                    <Box sx={{ height: "100%", width: `${w}%`, background: pos ? "#3ecf8e" : "#ff5566" }} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        <Typography sx={{ fontSize: "12px", color: "#8a8a82", mt: "16px", lineHeight: 1.55 }}>
          Your tier is a <b style={{ color: "#f0ede8" }}>live ML output</b> — the same behavioral model as Trader DNA. It scales the gap coefficient on every order, so discipline literally posts less margin.
        </Typography>
        <Box sx={{ display: "flex", gap: "8px", mt: "14px" }}>
          <Box
            component="button"
            onClick={() => {
              // full navigation to the bundled, venue-branded Trader DNA app (same domain).
              window.location.href = "/dna/";
            }}
            sx={{ px: "16px", py: "10px", borderRadius: "10px", background: "#ffb454", color: "#160f04", fontWeight: 600, fontFamily: MONO_FAMILY, fontSize: "13px", border: "none", cursor: "pointer" }}
          >
            Open full Trader DNA →
          </Box>
          <Box onClick={() => setOpen(false)} sx={{ px: "16px", py: "10px", borderRadius: "10px", border: "1px solid #242420", color: "#8a8a82", cursor: "pointer", fontSize: "13px" }}>Close</Box>
        </Box>
      </Dialog>
    </>
  );
};

export default PassportChip;
