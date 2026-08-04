/**
 * GapCoefficient — Perpify's "prices the dark" differentiator, woven into the market header
 * (not a separate page). Shows the live gap coefficient the engine streams, a countdown to the
 * next dark window, and a mini forward-curve sparkline so a trader sees not just the current
 * value but what's coming — the pre-close ramp and weekend hump. The point value comes from the
 * engine (`${sym}@gapCoefficient`); the countdown + sparkline are computed client-side from the
 * same gap-v0.1 model (frontend-BL/gap/gapModel). Tapping ⚡ previews a live weekend.
 */
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Box, Tooltip } from "@mui/material";
import TextView from "@/components/UI/TextView/TextView";
import { MONO_FAMILY } from "@/assets/Theme/typography";
import { perpifyWsSend } from "@/frontend-api-service/perpifyWsBridge";
import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";
import { forwardCurve, nextDark, gapScaleFor } from "@/frontend-BL/gap/gapModel";

function fmtCountdown(h: number): string {
  if (h <= 0) return "dark now";
  const d = Math.floor(h / 24);
  const hh = Math.floor(h % 24);
  const mm = Math.floor((h * 60) % 60);
  if (d > 0) return `${d}d ${hh}h`;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const GapCoefficient = () => {
  const { isLoggedIn } = useCheckLoginStatus();
  const selectedSymbol = useSelector((state: any) => state?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const gapRaw = useSelector((state: any) => state?.BinanceStreamData?.binanceData?.[`${selectedSymbol.toLowerCase()}@gapCoefficient`]);
  const gap = Number(gapRaw);
  const has = Number.isFinite(gap) && gap > 0;
  const raised = has && gap > 1.005;
  const elevated = has && gap > 1.1;
  const color = raised ? "#ffb454" : has ? "#4f8eff" : "text.regular";

  const scale = gapScaleFor(selectedSymbol);
  const sparkRef = useRef<HTMLCanvasElement | null>(null);
  const [, setTick] = useState(0);

  // countdown ticks; recompute the client-side "next dark" each render tick.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);
  const nd = nextDark(new Date(), "normal", scale);

  // draw the mini forward-curve sparkline (7d ahead) — the "what's coming" preview.
  useEffect(() => {
    const cv = sparkRef.current;
    if (!cv) return;
    const W = 62, H = 22, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const curve = forwardCurve(new Date(), 168, 60, "normal", scale);
    const mx = Math.max(1.04, ...curve.map((p) => p.coeff));
    const X = (h: number) => (h / 168) * W;
    const Y = (v: number) => H - 2 - ((v - 1) / (mx - 1)) * (H - 5);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(255,180,84,.45)"); grad.addColorStop(1, "rgba(255,180,84,0)");
    g.beginPath(); g.moveTo(0, H); curve.forEach((p) => g.lineTo(X(p.hoursFromNow), Y(p.coeff))); g.lineTo(W, H); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath(); curve.forEach((p, i) => { const x = X(p.hoursFromNow), y = Y(p.coeff); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = "#ffb454"; g.lineWidth = 1.3; g.stroke();
  }, [selectedSymbol, scale]);

  return (
    <Tooltip
      arrow
      placement="bottom"
      componentsProps={{ tooltip: { sx: { color: "#fff", fontSize: "11px", backgroundColor: "background.tertiary", fontWeight: 500, p: "10px", maxWidth: 260 } } }}
      title={
        <TextView
          text={
            `AI gap coefficient — your margin is multiplied by this, live. 1.00× during the continuous session; above 1.00× the nights/weekends are priced into your margin before the gap, not after. ${nd ? `Next dark (${nd.label}) opens at ${nd.coeffAtDark.toFixed(2)}×.` : ""}`
          }
        />
      }
    >
      <Box sx={{ minWidth: { sm: "182px", xs: "120px" }, display: "flex", alignItems: "center", gap: "9px" }}>
        <Box>
          <TextView component={"h5"} variant={"Medium_11"} color={"text.regular"} text={raised ? "Gap · pricing the dark" : "Gap Coefficient"} />
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <TextView component={"p"} variant={"SemiBold_16"} style={{ color, fontFamily: MONO_FAMILY }} text={has ? gap.toFixed(2) : "--"} />
            {has && <TextView component={"p"} variant={"Regular_11"} style={{ color, opacity: 0.7 }} text={"×"} />}
          </Box>
          {isLoggedIn && (
            <Box
              onClick={(e) => {
                e.stopPropagation();
                perpifyWsSend({ type: "demo_weekend", symbol: selectedSymbol });
              }}
              sx={{ cursor: "pointer", fontFamily: MONO_FAMILY, fontSize: 8.5, letterSpacing: "0.06em", color: elevated ? "#ffb454" : "#55554f", mt: "1px", whiteSpace: "nowrap", "&:hover": { color: "#ffb454" } }}
            >
              {elevated ? "⚡ weekend · tap live" : "⚡ preview weekend"}
            </Box>
          )}
        </Box>
        <Box sx={{ display: { xs: "none", sm: "flex" }, flexDirection: "column", alignItems: "flex-end", gap: "1px" }}>
          <canvas ref={sparkRef} style={{ display: "block" }} />
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 8.5, color: "#8a8a82", whiteSpace: "nowrap" }}>
            dark {nd ? fmtCountdown(nd.opensInHours) : "--"} · →{nd ? nd.coeffAtDark.toFixed(2) : "--"}×
          </Box>
        </Box>
      </Box>
    </Tooltip>
  );
};

export default GapCoefficient;
