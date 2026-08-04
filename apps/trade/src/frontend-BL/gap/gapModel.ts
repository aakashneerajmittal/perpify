/**
 * gapModel — client-side port of the engine's gapCoefficient (gap-v0.1), extended with a
 * FORWARD CURVE. The engine streams only the *current* coefficient; the reason Perpify's
 * "prices the dark" thesis doesn't land in the UI is that the current value is 1.00 during
 * market hours. The Gap Oracle fixes that by showing what's *coming* — the ramp into the
 * close, the overnight plateau, and the weekend hump — computed here from the same model.
 *
 * computeGapReading() is a faithful copy of engine/src/risk/gapCoefficient.ts (verified
 * identical by test/gapModel.parity.mjs). forwardCurve()/nextDark()/positionImpact() are the
 * additions the Oracle needs.
 */

const RMS: Record<string, number> = {
  "extended|calm": 0.0045786,
  "extended|crisis": 0.01635319,
  "extended|elevated": 0.01025528,
  "extended|normal": 0.00618733,
  "weeknight|calm": 0.00351759,
  "weeknight|crisis": 0.01535142,
  "weeknight|elevated": 0.00842219,
  "weeknight|normal": 0.00532147,
};
const RMS_REF = 0.00532147;
const ALPHA = 0.168812;
const COEFF_FLOOR = 1.0;
const COEFF_CAP = 2.5;
const PRECLOSE_RAMP_HOURS = 2.0;
const EXTENDED_MIN_HOURS = 39.0;
export const GAP_MODEL_VERSION = "gap-v0.1";

/** Per-underlying dark-premium scale (single stocks gap wider than the index). */
export const SYMBOL_GAP_SCALE: Record<string, number> = {
  "SPX-PERP": 1.0,
  "NVDA-PERP": 2.0,
  "AAPL-PERP": 1.35,
  "MSFT-PERP": 1.3,
  "GOOGL-PERP": 1.5,
  "AMZN-PERP": 1.6,
};
export const gapScaleFor = (market: string): number => SYMBOL_GAP_SCALE[market] ?? 1.0;

const OPEN_HOUR = 9.5;
const CLOSE_HOUR = 16.0;

export type DarkType = "weeknight" | "extended";
export interface GapReading {
  gapCoefficient: number;
  session: "open" | "weeknight" | "weekend";
  darkType: DarkType | null;
  hoursDarkRemaining: number;
  regime: string;
  modelVersion: string;
}

function coefficient(darkType: DarkType, regime: string, dTotal: number, dRemaining: number): number {
  const base = (RMS[`${darkType}|${regime}`] ?? RMS_REF) / RMS_REF;
  const dRem = Math.max(0, Math.min(dRemaining, dTotal));
  if (dRem <= 0 || dTotal <= 0) return COEFF_FLOOR;
  const glide = Math.pow(dRem / dTotal, ALPHA);
  return Math.min(COEFF_CAP, Math.max(COEFF_FLOOR, base * glide));
}

function etParts(now: Date): { dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dow = dows.indexOf(m.weekday ?? "");
  let hh = parseInt(m.hour ?? "0", 10);
  if (hh === 24) hh = 0;
  const hour = hh + parseInt(m.minute ?? "0", 10) / 60 + parseInt(m.second ?? "0", 10) / 3600;
  return { dow, hour };
}

export function computeGapReading(now: Date, regime = "normal", darkScale = 1.0): GapReading {
  const { dow, hour } = etParts(now);
  const w = dow * 24 + hour;

  const openStarts = [1, 2, 3, 4, 5].map((d) => d * 24 + OPEN_HOUR);
  const closeEnds = [1, 2, 3, 4, 5].map((d) => d * 24 + CLOSE_HOUR);

  const openIdx = openStarts.findIndex((o, i) => w >= o && w < closeEnds[i]!);
  const isOpen = openIdx >= 0;

  const openCands = [...openStarts, ...openStarts.map((o) => o + 168)];
  const closeCands = [...closeEnds.map((c) => c - 168), ...closeEnds];
  const nextOpen = Math.min(...openCands.filter((o) => o > w));
  const lastClose = Math.max(...closeCands.filter((c) => c <= w));
  const dTotal = nextOpen - lastClose;
  const dRemaining = nextOpen - w;
  const darkType: DarkType = dTotal >= EXTENDED_MIN_HOURS ? "extended" : "weeknight";

  if (isOpen) {
    const closeAt = closeEnds[openIdx]!;
    const hrsToClose = closeAt - w;
    if (hrsToClose <= PRECLOSE_RAMP_HOURS) {
      const upNextOpen = Math.min(...openCands.filter((o) => o > closeAt));
      const upTotal = upNextOpen - closeAt;
      const upDark: DarkType = upTotal >= EXTENDED_MIN_HOURS ? "extended" : "weeknight";
      const initial = 1 + (coefficient(upDark, regime, upTotal, upTotal) - 1) * darkScale;
      const ramp = (PRECLOSE_RAMP_HOURS - hrsToClose) / PRECLOSE_RAMP_HOURS;
      const coeff = Math.min(COEFF_CAP, 1 + ramp * (initial - 1));
      return { gapCoefficient: round6(coeff), session: "open", darkType: upDark, hoursDarkRemaining: 0, regime, modelVersion: GAP_MODEL_VERSION };
    }
    return { gapCoefficient: 1.0, session: "open", darkType: null, hoursDarkRemaining: 0, regime, modelVersion: GAP_MODEL_VERSION };
  }

  const coeff = Math.min(COEFF_CAP, 1 + (coefficient(darkType, regime, dTotal, dRemaining) - 1) * darkScale);
  return {
    gapCoefficient: round6(coeff),
    session: darkType === "extended" ? "weekend" : "weeknight",
    darkType,
    hoursDarkRemaining: round6(dRemaining),
    regime,
    modelVersion: GAP_MODEL_VERSION,
  };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Oracle additions
// ---------------------------------------------------------------------------
export interface CurvePoint {
  ms: number;               // absolute epoch ms
  hoursFromNow: number;
  coeff: number;
  session: "open" | "weeknight" | "weekend";
}

/** Sample the coefficient forward from `now` — the shape the Oracle draws. */
export function forwardCurve(now: Date, horizonHours = 168, stepMin = 30, regime = "normal", darkScale = 1.0): CurvePoint[] {
  const out: CurvePoint[] = [];
  const t0 = now.getTime();
  const stepMs = stepMin * 60000;
  const n = Math.floor((horizonHours * 60) / stepMin);
  for (let i = 0; i <= n; i++) {
    const ms = t0 + i * stepMs;
    const r = computeGapReading(new Date(ms), regime, darkScale);
    out.push({ ms, hoursFromNow: (ms - t0) / 3600000, coeff: r.gapCoefficient, session: r.session });
  }
  return out;
}

export interface NextDark {
  opensInHours: number;     // hours until the market next goes dark (next close)
  opensAtMs: number;
  darkType: DarkType;       // weeknight | extended(weekend)
  coeffAtDark: number;      // coefficient the instant the dark window opens
  label: string;            // "tonight's close" | "the Friday close"
}

/** When does the market next go dark, and what does the coefficient jump to? */
export function nextDark(now: Date, regime = "normal", darkScale = 1.0): NextDark | null {
  const t0 = now.getTime();
  const here = computeGapReading(now, regime, darkScale);
  // if already dark, "next dark" is the current window
  if (here.session !== "open") {
    return {
      opensInHours: 0,
      opensAtMs: t0,
      darkType: here.darkType ?? "weeknight",
      coeffAtDark: here.gapCoefficient,
      label: here.session === "weekend" ? "this weekend" : "tonight",
    };
  }
  // In an open session the next dark opens at the next market close — compute it directly from
  // the ET week-clock (O(1)) instead of minute-stepping over 8 days (which created ~11.5k
  // Intl.DateTimeFormat objects per call and janked the header on every stream tick). One
  // reading just after that close gives the dark window's opening coefficient.
  const { dow, hour } = etParts(now);
  const w = dow * 24 + hour;
  const closeEnds = [1, 2, 3, 4, 5].map((d) => d * 24 + CLOSE_HOUR);
  const closeCands = [...closeEnds, ...closeEnds.map((c) => c + 168)];
  const nextClose = Math.min(...closeCands.filter((c) => c > w));
  const opensInHours = nextClose - w;
  const opensAtMs = t0 + opensInHours * 3600000;
  const r = computeGapReading(new Date(opensAtMs + 60000), regime, darkScale);
  return {
    opensInHours,
    opensAtMs,
    darkType: r.darkType ?? "weeknight",
    coeffAtDark: r.gapCoefficient,
    label: r.session === "weekend" ? "the Friday close" : "tonight's close",
  };
}

/**
 * Extra margin a position posts when the dark window opens, in account ccy.
 * margin = notional × baseImBps × gapCoeff × tierMult  (engine margin.ts); the gap-driven
 * delta between now and the dark open is what the trader feels.
 */
export function positionImpact(notionalUsd: number, coeffNow: number, coeffDark: number, tierMult = 1.0, baseImBps = 0.3333): {
  marginNow: number;
  marginDark: number;
  extra: number;
} {
  const marginNow = notionalUsd * baseImBps * coeffNow * tierMult;
  const marginDark = notionalUsd * baseImBps * coeffDark * tierMult;
  return { marginNow, marginDark, extra: marginDark - marginNow };
}
