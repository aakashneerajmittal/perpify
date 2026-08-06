/**
 * TierChangeToast — the live "your behavior just moved your margin" moment.
 *
 * The engine recomputes each connected trader's behavioral tier from their real on-venue behavior
 * and pushes a fresh SESSION_INFO whenever it changes (risk/tierScore + wire/server). The websocket
 * middleware diffs that against the prior tier and dispatches TIER_CHANGED; this component watches
 * sessionInfo.lastChange and surfaces a transient, explainable card: old → new tier, the margin
 * delta it buys on every order, and the named factors that caused it. This is the proof the tier is
 * a live output, not a badge — two identical trades cost different margin because behavior moved.
 *
 * Self-contained (own timer + fixed positioning); reads state already in Redux. Renders nothing
 * until a real change arrives.
 */
import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useSelector } from "react-redux";
import { MONO_FAMILY, DISPLAY_FAMILY } from "@/assets/Theme/typography";
import type { TierChange } from "@/frontend-BL/redux/reducers/Internal/SessionInfo.r";

const GREEN = "#3ECF8E";
const RED = "#FF5555";
const TEXT = "#F0EDE8";
const MUTED = "#8A8A82";
const DIM = "#55554E";

const prettyFactor = (n: string) => String(n).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const TierChangeToast: React.FC = () => {
  const change = useSelector((s: any) => s?.sessionInfo?.lastChange) as TierChange | null;
  const [shown, setShown] = useState<TierChange | null>(null);
  const seenSeq = useRef(0);

  useEffect(() => {
    if (change && change.seq && change.seq !== seenSeq.current) {
      seenSeq.current = change.seq;
      setShown(change);
      const t = setTimeout(() => setShown(null), 8000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [change?.seq]);

  if (!shown) return null;

  const { from, to, fromMult, toMult, factors } = shown;
  // The multiplier is the truth: lower = cheaper margin = the trader earned trust.
  const improved = typeof fromMult === "number" ? toMult < fromMult : String(to) < String(from);
  const accent = improved ? GREEN : RED;
  const deltaPct = typeof fromMult === "number" && fromMult > 0 ? Math.round((toMult / fromMult - 1) * 100) : null;
  const headline = improved ? "Risk tier improved" : "Risk tier tightened";
  const topFactors = (Array.isArray(factors) ? factors : []).slice(0, 2).map((f) => prettyFactor(f.name));

  return (
    <Box
      sx={{
        position: "fixed",
        right: { xs: 10, sm: 16 },
        bottom: { xs: 74, sm: 84 },
        zIndex: 2000,
        width: { xs: "calc(100vw - 20px)", sm: 340 },
        maxWidth: 360,
        background: "linear-gradient(180deg,#141414,#0d0d0b)",
        border: `1px solid ${accent}66`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "12px",
        boxShadow: `0 10px 34px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)`,
        p: "13px 14px",
        animation: "tierToastIn 260ms cubic-bezier(0.16,1,0.3,1)",
        "@keyframes tierToastIn": {
          from: { opacity: 0, transform: "translateY(14px) scale(0.98)" },
          to: { opacity: 1, transform: "translateY(0) scale(1)" }
        }
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: DIM }}>
          Behavioral tier · live
        </Box>
        <Box
          onClick={() => setShown(null)}
          sx={{ cursor: "pointer", color: MUTED, fontSize: "14px", lineHeight: 1, mt: "-2px", "&:hover": { color: TEXT } }}
        >
          ✕
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", mt: "9px" }}>
        {/* from → to badges */}
        <Box sx={{ display: "flex", alignItems: "center", gap: "7px", flexShrink: 0 }}>
          <Box
            sx={{
              width: 30, height: 30, borderRadius: "8px", display: "grid", placeItems: "center",
              border: `1px solid ${MUTED}55`, color: MUTED, fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: 15
            }}
          >
            {from}
          </Box>
          <Box sx={{ color: accent, fontSize: 15, lineHeight: 1 }}>→</Box>
          <Box
            sx={{
              width: 34, height: 34, borderRadius: "8px", display: "grid", placeItems: "center",
              background: `${accent}1F`, border: `1px solid ${accent}`, color: accent, fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: 18
            }}
          >
            {to}
          </Box>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: 14, color: TEXT, lineHeight: 1.15 }}>{headline}</Box>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11.5, color: MUTED, mt: "2px" }}>
            Margin ×{toMult.toFixed(2)}
            {deltaPct !== null && (
              <Box component="span" sx={{ color: accent, fontWeight: 600 }}>
                {"  "}
                {deltaPct <= 0 ? "" : "+"}
                {deltaPct}% on every order
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {topFactors.length > 0 && (
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 10.5, color: MUTED, mt: "10px", lineHeight: 1.5 }}>
          <Box component="span" sx={{ color: DIM }}>why: </Box>
          {topFactors.join(" · ")}
        </Box>
      )}
    </Box>
  );
};

export default TierChangeToast;
