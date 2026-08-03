/**
 * gapCoefficient — the "prices the dark" margin coefficient, computed live in the
 * engine from the real US-equity market clock. This is a faithful TypeScript port of
 * risk/gap/model.py (gap-v0.1) so the deployed engine needs no Python and the
 * coefficient moves with the actual session:
 *
 *   coeff(dark, regime, d_total, d_remaining) =
 *       clamp( (RMS[dark|regime]/RMS_ref) · (d_remaining/d_total)^alpha , 1.0 , 2.5 )
 *
 * During market hours the coefficient is 1.0 until PRECLOSE_RAMP_HOURS before the
 * close, then ramps to the upcoming dark period's opening value ("the Friday 4pm
 * rule"). Regime is held at "normal" for v0 (the model holds regime through the dark
 * period; live regime from realized vol is a v0.1+ item).
 *
 * Params are the calibrated gap-v0.1 fit (31y SPY, risk/gap/params/gap-v0.1.json).
 */

// --- calibrated params (gap-v0.1) ---
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
const RMS_REF = 0.00532147; // weeknight|normal
const ALPHA = 0.168812;
const COEFF_FLOOR = 1.0;
const COEFF_CAP = 2.5;
const PRECLOSE_RAMP_HOURS = 2.0;
const EXTENDED_MIN_HOURS = 39.0;
export const GAP_MODEL_VERSION = "gap-v0.1";

/**
 * Per-underlying dark-premium scale (v0). Single stocks gap wider than the index across a
 * dark period, so the above-1.0 portion of the index coefficient is scaled per symbol.
 * Vol-scaled from the index model today (SPX = 1.0); calibratable from per-stock daily
 * history. Applied as: coeff = 1 + (indexCoeff − 1) × scale, clamped to the cap.
 */
export const SYMBOL_GAP_SCALE: Record<string, number> = {
  "SPX-PERP": 1.0,
  "NVDA-PERP": 2.0,
  "AAPL-PERP": 1.35,
  "MSFT-PERP": 1.3,
  "GOOGL-PERP": 1.5,
  "AMZN-PERP": 1.6,
};
export const gapScaleFor = (market: string): number => SYMBOL_GAP_SCALE[market] ?? 1.0;

const OPEN_HOUR = 9.5; // 09:30 ET
const CLOSE_HOUR = 16.0; // 16:00 ET

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

/** Current ET wall-clock as {dow 0=Sun..6=Sat, hour: float 0..24}. Intl handles DST. */
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

/**
 * Compute the live gap reading for `now`. Uses a 168-hour week (Sun 00:00 = 0) with
 * regular sessions Mon–Fri 09:30–16:00 ET; holidays are out of scope for v0.
 */
export function computeGapReading(now: Date, regime = "normal", darkScale = 1.0): GapReading {
  const { dow, hour } = etParts(now);
  const w = dow * 24 + hour; // week-hour, 0..168

  const openStarts = [1, 2, 3, 4, 5].map((d) => d * 24 + OPEN_HOUR); // Mon..Fri 09:30
  const closeEnds = [1, 2, 3, 4, 5].map((d) => d * 24 + CLOSE_HOUR); // Mon..Fri 16:00

  // is the market open right now?
  const openIdx = openStarts.findIndex((o, i) => w >= o && w < closeEnds[i]!);
  const isOpen = openIdx >= 0;

  // next open (this week or next) and last close (this week or prior)
  const openCands = [...openStarts, ...openStarts.map((o) => o + 168)];
  const closeCands = [...closeEnds.map((c) => c - 168), ...closeEnds];
  const nextOpen = Math.min(...openCands.filter((o) => o > w));
  const lastClose = Math.max(...closeCands.filter((c) => c <= w));
  const dTotal = nextOpen - lastClose; // full dark period length
  const dRemaining = nextOpen - w; // dark hours left until the next open
  const darkType: DarkType = dTotal >= EXTENDED_MIN_HOURS ? "extended" : "weeknight";

  if (isOpen) {
    // 1.0 during the session, ramping in the last PRECLOSE_RAMP_HOURS toward the
    // upcoming dark period's opening coefficient.
    const closeAt = closeEnds[openIdx]!;
    const hrsToClose = closeAt - w;
    if (hrsToClose <= PRECLOSE_RAMP_HOURS) {
      // upcoming dark period after THIS close
      const upNextOpen = Math.min(...openCands.filter((o) => o > closeAt));
      const upTotal = upNextOpen - closeAt;
      const upDark: DarkType = upTotal >= EXTENDED_MIN_HOURS ? "extended" : "weeknight";
      const initial = 1 + (coefficient(upDark, regime, upTotal, upTotal) - 1) * darkScale;
      const ramp = (PRECLOSE_RAMP_HOURS - hrsToClose) / PRECLOSE_RAMP_HOURS; // 0..1
      const coeff = Math.min(COEFF_CAP, 1 + ramp * (initial - 1));
      return {
        gapCoefficient: round6(coeff),
        session: "open",
        darkType: upDark,
        hoursDarkRemaining: 0,
        regime,
        modelVersion: GAP_MODEL_VERSION,
      };
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
