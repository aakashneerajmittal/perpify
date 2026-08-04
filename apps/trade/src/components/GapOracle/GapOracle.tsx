/**
 * GapOracle — Perpify's identity surface. The venue's differentiator ("prices the dark,
 * clears the reopen") made visible: the live gap coefficient for the selected market, a
 * 7-day FORWARD curve of what the model will charge hour-by-hour, a live countdown to the
 * next dark window, and the dollar margin a position posts when the dark opens. Reads the
 * same gap-v0.1 model the engine uses (frontend-BL/gap/gapModel), the real selected symbol,
 * and the trader's behavioral tier multiplier — so discipline visibly pays less margin.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, useMediaQuery } from "@mui/material";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { MONO_FAMILY, DISPLAY_FAMILY } from "@/assets/Theme/typography";
import { computeGapReading, forwardCurve, nextDark, positionImpact, gapScaleFor, GAP_MODEL_VERSION, SYMBOL_GAP_SCALE } from "@/frontend-BL/gap/gapModel";

const SYMS = Object.keys(SYMBOL_GAP_SCALE);
const REGS: [string, string][] = [
  ["calm", "Calm"],
  ["normal", "Normal"],
  ["elevated", "Elevated"],
  ["crisis", "Crisis"],
];
const C = { bg: "#070707", bg1: "#0d0d0d", bg2: "#131313", bg3: "#1b1b18", line: "#242420", ink: "#f0ede8", mut: "#8a8a82", dim: "#55554e", amber: "#ffb454", blue: "#4f8eff", green: "#3ecf8e", red: "#ff5566" };

const fmt = (n: number) => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
};
const fmtHrs = (h: number) => {
  if (h <= 0) return "now";
  const d = Math.floor(h / 24), hh = Math.floor(h % 24), mm = Math.floor((h * 60) % 60), ss = Math.floor((h * 3600) % 60);
  if (d > 0) return `${d}d ${hh}h ${mm}m`;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

const Seg = ({ items, cur, onPick }: { items: [string, string][]; cur: string; onPick: (v: string) => void }) => (
  <Box sx={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: "10px", overflow: "hidden", background: C.bg1 }}>
    {items.map(([v, l]) => (
      <Box
        key={v}
        component="button"
        onClick={() => onPick(v)}
        sx={{
          px: "12px", py: "8px", fontSize: "12.5px", fontFamily: MONO_FAMILY, cursor: "pointer",
          border: "none", borderRight: `1px solid ${C.line}`, "&:last-of-type": { borderRight: "none" },
          color: v === cur ? C.ink : C.mut, background: v === cur ? C.bg3 : "transparent",
        }}
      >
        {l}
      </Box>
    ))}
  </Box>
);

const GapOracle: React.FC = () => {
  const navigate = useNavigate();
  const isNarrow = useMediaQuery("(max-width:820px)");
  const selectedSymbol = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const tierMult = Number(useSelector((s: any) => s?.sessionInfo?.tierMult)) || 1.0;
  const tier = useSelector((s: any) => s?.sessionInfo?.tier) || null;

  const [sym, setSym] = useState<string>(SYMS.includes(selectedSymbol) ? selectedSymbol : "SPX-PERP");
  const [reg, setReg] = useState<string>("normal");
  const [scrub, setScrub] = useState<number>(0);
  const [sizeStr, setSizeStr] = useState<string>("50,000");
  const [, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const scale = gapScaleFor(sym);

  // live tick (1s) — only advances "now" when not scrubbing
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(Date.now() + scrub * 3600000), [scrub, /* re-eval each tick */ Math.floor(Date.now() / 1000)]);
  const reading = computeGapReading(now, reg, scale);
  const nd = nextDark(now, reg, scale);
  const sizeNum = parseFloat((sizeStr || "0").replace(/[,$\s]/g, "")) || 0;
  const impact = positionImpact(sizeNum, reading.gapCoefficient, nd ? nd.coeffAtDark : reading.gapCoefficient, tierMult);

  // draw forward curve
  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const W = (wrapRef.current?.clientWidth || 900);
    const H = 560;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const base = new Date();
    const curve = forwardCurve(base, 168, 15, reg, scale);
    const maxC = Math.max(1.05, ...curve.map((p) => p.coeff));
    const yMax = Math.ceil(maxC * 20) / 20, yMin = 1.0;
    const padL = 52, padR = 14, padT = 16, padB = 40, plotW = W - padL - padR, plotH = H - padT - padB;
    const X = (h: number) => padL + (h / 168) * plotW;
    const Y = (c: number) => padT + plotH * (1 - (c - yMin) / (yMax - yMin));
    for (let i = 0; i < curve.length - 1; i++) {
      const p = curve[i];
      if (p.session !== "open") { g.fillStyle = p.session === "weekend" ? "rgba(255,85,102,.05)" : "rgba(255,180,84,.045)"; g.fillRect(X(p.hoursFromNow), padT, Math.max(1, X(curve[i + 1].hoursFromNow) - X(p.hoursFromNow)) + 0.5, plotH); }
    }
    g.font = "10px " + MONO_FAMILY; g.textAlign = "right"; g.textBaseline = "middle";
    for (let c = yMin; c <= yMax + 1e-9; c += 0.1) { g.strokeStyle = "#17170f"; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, Y(c)); g.lineTo(W - padR, Y(c)); g.stroke(); g.fillStyle = C.dim; g.fillText(c.toFixed(2) + "×", padL - 8, Y(c)); }
    g.textAlign = "center"; g.textBaseline = "top";
    for (let h = 0; h <= 168; h += 24) {
      const d = new Date(base.getTime() + h * 3600000);
      const nm = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
      g.strokeStyle = "#201f18"; g.beginPath(); g.moveTo(X(h), padT); g.lineTo(X(h), padT + plotH); g.stroke();
      if (h < 168) { g.fillStyle = "#6a6a60"; g.fillText(nm, X(h + 12), padT + plotH + 8); }
    }
    const grad = g.createLinearGradient(0, padT, 0, padT + plotH); grad.addColorStop(0, "rgba(255,180,84,.28)"); grad.addColorStop(1, "rgba(255,180,84,.02)");
    g.beginPath(); g.moveTo(X(0), Y(curve[0].coeff)); for (const p of curve) g.lineTo(X(p.hoursFromNow), Y(p.coeff)); g.lineTo(X(curve[curve.length - 1].hoursFromNow), Y(yMin)); g.lineTo(X(0), Y(yMin)); g.closePath(); g.fillStyle = grad; g.fill();
    g.lineWidth = 2.4; g.lineJoin = "round";
    for (let i = 0; i < curve.length - 1; i++) {
      const p = curve[i], q = curve[i + 1];
      const col = p.session === "open" ? (p.coeff > 1.001 ? C.blue : C.green) : p.session === "weekend" ? "#ff8a5c" : C.amber;
      g.strokeStyle = col; g.beginPath(); g.moveTo(X(p.hoursFromNow), Y(p.coeff)); g.lineTo(X(q.hoursFromNow), Y(q.coeff)); g.stroke();
    }
    const nx = X(Math.max(0, Math.min(168, scrub)));
    g.strokeStyle = "rgba(240,237,232,.6)"; g.lineWidth = 1.2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(nx, padT); g.lineTo(nx, padT + plotH); g.stroke(); g.setLineDash([]);
    const rScrub = computeGapReading(new Date(base.getTime() + scrub * 3600000), reg, scale);
    const py = Y(rScrub.gapCoefficient); g.fillStyle = C.ink; g.beginPath(); g.arc(nx, py, 4.5, 0, 7); g.fill(); g.fillStyle = "#0a0a0a"; g.beginPath(); g.arc(nx, py, 2, 0, 7); g.fill();
    const peak = curve.reduce((a, b) => (b.coeff > a.coeff ? b : a), curve[0]);
    if (peak.coeff > 1.03) { g.fillStyle = C.amber; g.font = "bold 11px " + DISPLAY_FAMILY; g.textAlign = "center"; g.textBaseline = "bottom"; g.fillText(peak.coeff.toFixed(2) + "× peak", Math.min(W - 50, Math.max(50, X(peak.hoursFromNow))), Y(peak.coeff) - 8); }
  };
  // Redraw on control changes, on container resize (fixes the first-paint 0-width case),
  // and once per second so the "now" marker stays live. draw() reads current state via closure;
  // deps re-arm the interval/observer whenever sym/reg/scrub change.
  useEffect(() => {
    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const id = setInterval(() => draw(), 1000);
    // a couple of deferred draws to catch late layout/font settle
    const t1 = setTimeout(draw, 60);
    const t2 = setTimeout(draw, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      clearInterval(id);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    /* eslint-disable-next-line */
  }, [sym, reg, scrub, isNarrow]);

  const sessMap: Record<string, [string, string]> = {
    open: [C.green, "MARKET OPEN — continuous"],
    weeknight: [C.amber, "DARK — overnight gap priced"],
    weekend: [C.red, "DARK — weekend gap priced"],
  };
  const [sc, sl] = sessMap[reading.session];
  const preclose = reading.session === "open" && reading.gapCoefficient > 1.001;

  const Card: React.FC<{ children: React.ReactNode; sx?: any }> = ({ children, sx }) => (
    <Box sx={{ background: C.bg1, border: `1px solid ${C.line}`, borderRadius: "16px", p: "20px", ...sx }}>{children}</Box>
  );
  const SectionT: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography sx={{ fontSize: "12px", letterSpacing: ".14em", textTransform: "uppercase", color: C.dim, fontFamily: MONO_FAMILY }}>{children}</Typography>
  );

  return (
    <Box sx={{ background: C.bg, minHeight: "100%", color: C.ink, fontFamily: MONO_FAMILY, pb: "48px" }}>
      <Box sx={{ maxWidth: "1120px", mx: "auto", px: "22px" }}>
        {/* hero */}
        <Box sx={{ pt: "28px", pb: "8px" }}>
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: "6px", px: "10px", py: "4px", borderRadius: "999px", fontSize: "11px", border: `1px solid ${C.line}`, color: C.mut, background: C.bg1, mb: "14px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.amber, display: "inline-block" }} /> the margin no other venue shows you
          </Box>
          <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: { xs: "30px", md: "44px" }, lineHeight: 1.03, letterSpacing: "-.02em" }}>
            Perpify prices <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: "italic", fontWeight: 400, color: C.amber }}>the dark.</span>
          </Typography>
          <Typography sx={{ color: C.mut, maxWidth: "66ch", mt: "12px", fontSize: "14.5px", fontFamily: MONO_FAMILY }}>
            Markets close. Risk doesn't. Every night and weekend, price gaps while you can't trade — and every other perp venue runs a <b style={{ color: C.ink }}>static</b> margin number and lets that gap hit you at the reopen. This is Perpify's live model of overnight &amp; weekend gap risk: it charges for the dark <b style={{ color: C.ink }}>before</b> it happens, and sequences the reopen.
          </Typography>
        </Box>

        {/* controls */}
        <Box sx={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", mt: "20px", mb: "6px" }}>
          <Typography sx={{ fontSize: "11px", letterSpacing: ".1em", textTransform: "uppercase", color: C.dim }}>Market</Typography>
          <Seg items={SYMS.map((s) => [s, s.replace("-PERP", "")]) as [string, string][]} cur={sym} onPick={setSym} />
          <Typography sx={{ fontSize: "11px", letterSpacing: ".1em", textTransform: "uppercase", color: C.dim, ml: "8px" }}>Regime</Typography>
          <Seg items={REGS} cur={reg} onPick={setReg} />
        </Box>

        {/* hero cards */}
        <Box sx={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1.05fr 1fr 1fr", gap: "14px", mt: "14px" }}>
          <Card>
            <SectionT>Live gap coefficient</SectionT>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: "2px", mt: "2px" }}>
              <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "58px", lineHeight: 1, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{reading.gapCoefficient.toFixed(2)}</Typography>
              <Typography sx={{ fontSize: "24px", color: C.mut, fontWeight: 600 }}>×</Typography>
            </Box>
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12px", px: "10px", py: "4px", borderRadius: "999px", mt: "6px", width: "fit-content", background: sc + "22", color: sc }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc, display: "inline-block" }} /> {preclose ? "PRE-CLOSE RAMP — pricing tonight's gap" : sl}
            </Box>
            <Typography sx={{ fontSize: "12px", color: C.mut, mt: "8px" }}>
              {reading.session === "open" && !preclose ? "1.00× — continuous session, no gap to price right now." : `${((reading.gapCoefficient - 1) * 100).toFixed(0)}% gap premium on your margin, live.`}
            </Typography>
          </Card>
          <Card>
            <SectionT>Countdown to dark</SectionT>
            <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "34px", letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums", mt: "4px" }}>{nd ? fmtHrs(nd.opensInHours) : "—"}</Typography>
            <Typography sx={{ fontSize: "12px", color: C.mut }}>{nd ? (nd.opensInHours <= 0 ? "dark now · " + nd.label : "until " + nd.label) : ""}</Typography>
          </Card>
          <Card>
            <SectionT>Coefficient at the dark open</SectionT>
            <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "34px", letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums", mt: "4px" }}>
              <span style={{ color: C.amber }}>→</span> {nd ? nd.coeffAtDark.toFixed(2) : "—"}×
            </Typography>
            <Typography sx={{ fontSize: "12px", color: C.mut }}>{nd ? (nd.darkType === "extended" ? "weekend dark — the big one" : "overnight dark") : ""}</Typography>
          </Card>
        </Box>

        {/* forward curve */}
        <Card sx={{ mt: "14px" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px", mb: "8px" }}>
            <SectionT>7-day forward curve — what the model will charge, hour by hour</SectionT>
            <Typography sx={{ fontSize: "12px", color: C.mut }}>{sym} · {reg} regime · ×{scale.toFixed(2)} symbol scale</Typography>
          </Box>
          <div ref={wrapRef} style={{ width: "100%" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
          </div>
          <Box sx={{ display: "flex", gap: "16px", flexWrap: "wrap", mt: "8px", fontSize: "11.5px", color: C.mut }}>
            <span><i style={{ width: 12, height: 4, borderRadius: 2, background: C.green, display: "inline-block", marginRight: 6 }} /> market open (1.00×)</span>
            <span><i style={{ width: 12, height: 4, borderRadius: 2, background: C.amber, display: "inline-block", marginRight: 6 }} /> overnight / weekend dark</span>
            <span><i style={{ width: 12, height: 4, borderRadius: 2, background: C.blue, display: "inline-block", marginRight: 6 }} /> pre-close ramp — the "Friday 4pm rule"</span>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: "10px", mt: "12px", fontSize: "12px", color: C.mut }}>
            <span>Time machine</span>
            <input type="range" min={0} max={167} step={0.25} value={scrub} onChange={(e) => setScrub(parseFloat(e.target.value))} style={{ flex: 1, accentColor: C.amber }} />
            <span style={{ minWidth: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{scrub === 0 ? "now" : "+" + fmtHrs(scrub).replace(/:\d\d$/, "") + " ahead"}</span>
          </Box>
        </Card>

        {/* impact + why */}
        <Box sx={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: "14px", mt: "14px" }}>
          <Card>
            <SectionT>What the dark costs your position</SectionT>
            <Typography sx={{ fontSize: "12px", color: C.mut, mt: "12px", mb: "5px" }}>Position size (USD notional)</Typography>
            <input value={sizeStr} onChange={(e) => setSizeStr(e.target.value)} style={{ width: "100%", background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 12px", color: C.ink, fontFamily: MONO_FAMILY, fontSize: 15 }} />
            <Box sx={{ display: "flex", alignItems: "baseline", gap: "8px", mt: "14px" }}>
              <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 800, fontSize: "38px", letterSpacing: "-.02em", color: C.amber }}>{impact.extra >= 0 ? "+$" : "-$"}{fmt(Math.abs(impact.extra))}</Typography>
              <Typography sx={{ color: C.mut, fontSize: "13px" }}>{impact.extra > 1 ? "more margin when the dark opens" : "you're already in the dark window"}</Typography>
            </Box>
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mt: "12px", fontSize: "13px", "& td": { py: "7px", borderBottom: `1px solid ${C.bg3}`, color: C.mut }, "& td:last-of-type": { textAlign: "right", color: C.ink, fontVariantNumeric: "tabular-nums" }, "& tr:last-of-type td": { borderBottom: "none" } }}>
              <tbody>
                <tr><td>Margin now ({reading.gapCoefficient.toFixed(2)}× · {reading.session})</td><td>${fmt(impact.marginNow)}</td></tr>
                <tr><td>Margin at the dark open ({nd ? nd.coeffAtDark.toFixed(2) : "—"}×)</td><td>${fmt(impact.marginDark)}</td></tr>
                <tr><td>Priced <b style={{ color: C.amber }}>before</b> the gap, not after</td><td style={{ color: C.amber }}>{impact.extra >= 0 ? "+$" : "-$"}{fmt(Math.abs(impact.extra))}</td></tr>
              </tbody>
            </Box>
            <Typography sx={{ fontSize: "11.5px", color: C.dim, mt: "10px" }}>
              33% base initial margin × your tier {tier ? `(${tier} · ${tierMult}×)` : `(${tierMult}×)`}. Discipline lowers your tier multiplier — so a better behavioral score literally posts less margin here.
            </Typography>
          </Card>
          <Box sx={{ background: "linear-gradient(180deg,rgba(255,180,84,.05),transparent)", border: "1px solid #2a2419", borderRadius: "16px", p: "22px" }}>
            <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 700, fontSize: "19px" }}>Why this isn't another DEX</Typography>
            <Typography sx={{ color: C.mut, mt: "8px", fontSize: "14px" }}>
              A crypto perp DEX runs 24/7, so it never has to think about the gap — one static maintenance-margin number covers everything. Perpify lists <b style={{ color: C.ink }}>equity</b> perps, which go dark every night and weekend. That's a different risk, and it needs a different engine.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 1fr", gap: "14px", mt: "16px" }}>
              {[["Prices the dark", "Gap risk is charged on a live model before the close — not discovered at the reopen."], ["Sequences the reopen", "The book reopens in a controlled auction, not a chaotic first-print stampede."], ["Underwrites the trader", "Your behavioral tier scales this coefficient — discipline literally pays less margin."]].map(([h, s]) => (
                <Box key={h} sx={{ borderLeft: `2px solid ${C.amber}`, pl: "12px" }}>
                  <Typography sx={{ fontFamily: DISPLAY_FAMILY, fontWeight: 700, fontSize: "13.5px", color: C.ink }}>{h}</Typography>
                  <Typography sx={{ color: C.mut, fontSize: "13px", mt: "3px" }}>{s}</Typography>
                </Box>
              ))}
            </Box>
            <Box component="button" onClick={() => navigate("/")} sx={{ mt: "18px", px: "18px", py: "11px", borderRadius: "10px", background: C.amber, color: "#1a1206", fontWeight: 600, fontFamily: MONO_FAMILY, fontSize: "14px", border: "none", cursor: "pointer" }}>
              Trade it on Perpify →
            </Box>
          </Box>
        </Box>

        <Typography sx={{ mt: "26px", pt: "20px", borderTop: `1px solid ${C.line}`, color: C.dim, fontSize: "12px" }}>
          Gap Oracle — "prices the dark, clears the reopen." Coefficient model {GAP_MODEL_VERSION} (31-yr SPY calibration). Illustrative · not investment advice.
        </Typography>
      </Box>
    </Box>
  );
};

export default GapOracle;
