/**
 * TierCard — surfaces the venue's behavioral underwriting for the connected wallet:
 * the AI-assigned risk tier (A–E), the margin multiplier and tier-gated leverage it
 * buys, and the named factors that produced it. This is the "the venue knows you"
 * proof — two wallets pay different margin for the same trade.
 *
 * Data comes from the engine's SESSION_INFO (redux `sessionInfo`). Renders only when
 * logged in and a tier is present.
 */
import React, { useState } from "react";
import { Box, Collapse } from "@mui/material";
import { useSelector } from "react-redux";
import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";
import { MONO_FAMILY, SERIF_FAMILY } from "@/assets/Theme/typography";

const TIER_COLOR: Record<string, string> = {
  A: "#3ECF8E",
  B: "#4F8EFF",
  C: "#9A9A90",
  D: "#EBB62F",
  E: "#FF5555"
};
const TEXT = "#F0EDE8";
const MUTED = "#888880";
const DIM = "#55554F";

const prettyFactor = (n: string) =>
  n.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function TierCard() {
  const { isLoggedIn } = useCheckLoginStatus();
  const s = useSelector((st: any) => st.sessionInfo) || {};
  const [open, setOpen] = useState(false);

  if (!isLoggedIn || !s.tier) return null;

  const color = TIER_COLOR[s.tier] || MUTED;
  const mult = typeof s.tierMult === "number" ? s.tierMult : 1;
  const pct = Math.round((mult - 1) * 100);
  const marginNote =
    pct < 0 ? `${Math.abs(pct)}% below baseline` : pct > 0 ? `${pct}% above baseline` : "at baseline";
  const factors = Array.isArray(s.factors) ? s.factors : [];

  return (
    <Box
      sx={{
        m: "10px 8px 0",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        background: "#111111",
        overflow: "hidden"
      }}
    >
      {/* header row */}
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", p: "12px 12px 10px" }}>
        {/* tier badge */}
        <Box
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: "9px",
            display: "grid",
            placeItems: "center",
            background: `${color}1F`,
            border: `1px solid ${color}66`
          }}
        >
          <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1, color }}>{s.tier}</Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.16em", color: DIM, textTransform: "uppercase", mb: "3px" }}>
            Behavioral Tier
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
            <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 13, color: TEXT }}>
              Margin <span style={{ color }}>×{mult.toFixed(2)}</span>
            </Box>
            {typeof s.maxLeverage === "number" && (
              <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 13, color: TEXT }}>
                up to <span style={{ color: TEXT }}>{s.maxLeverage}×</span>
              </Box>
            )}
          </Box>
        </Box>

        <Box
          onClick={() => setOpen((o) => !o)}
          sx={{
            fontFamily: MONO_FAMILY,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: MUTED,
            cursor: "pointer",
            whiteSpace: "nowrap",
            "&:hover": { color: TEXT }
          }}
        >
          {open ? "hide" : "why ▾"}
        </Box>
      </Box>

      {/* margin note strip */}
      <Box sx={{ px: "12px", pb: open ? "10px" : "12px" }}>
        <Box sx={{ fontFamily: SERIF_FAMILY, fontStyle: "italic", fontSize: 13, color: MUTED, lineHeight: 1.4 }}>
          You pay margin {marginNote} — the venue prices your history, not a static table.
        </Box>
      </Box>

      {/* expandable factors */}
      <Collapse in={open}>
        <Box sx={{ px: "12px", pb: "12px", pt: "2px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.16em", color: DIM, textTransform: "uppercase", m: "10px 0 8px" }}>
            Factors moving your tier
          </Box>
          {factors.map((f: any, i: number) => {
            const contribution = Math.round((Number(f.contribution) || 0) * 100);
            return (
              <Box key={i} sx={{ mb: "8px" }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: "3px" }}>
                  <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 500, fontSize: 12.5, color: TEXT }}>{prettyFactor(f.name)}</Box>
                  <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11, color: MUTED }}>{contribution}%</Box>
                </Box>
                <Box sx={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <Box sx={{ height: "100%", width: `${contribution}%`, background: color, borderRadius: 2 }} />
                </Box>
              </Box>
            );
          })}
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, color: DIM, mt: "10px", lineHeight: 1.6 }}>
            {s.modelVersion || "tier-v0.1"} · provisional · refits as you trade
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
