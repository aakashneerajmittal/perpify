/**
 * regime — the market volatility regime that conditions the gap coefficient.
 *
 * The gap model's above-1.0 premium depends on the regime (RMS[dark|regime]); v0 held this at
 * "normal". This module sources the LIVE regime from the risk pipeline's published reading
 * (risk/gap/out/reading-current.json), which is computed from real SPY realized vol and
 * re-published (with its artifact hash posted on-chain) by risk/gap/publish.py. So the engine's
 * live coefficient now moves with the actual market regime: it elevates in genuine stress
 * (elevated/crisis raise the premium) and relaxes in calm — instead of being pinned.
 *
 * Why not measure realized vol in-engine? The testnet tapes are synthetic OU wiggles whose
 * micro-noise carries no macro-vol signal; estimating regime from them yields nonsense. The
 * calibrated pipeline, fed real market data, is the correct and trustworthy source. If the
 * published reading is missing or malformed the engine falls back to "normal" (the v0 default),
 * so this can only add fidelity, never regress the live demo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Regime = "calm" | "normal" | "elevated" | "crisis";
const REGIMES: readonly Regime[] = ["calm", "normal", "elevated", "crisis"];

// annualized-vol regime bounds — must match risk/gap/params/gap-v0.1.json `regimeBoundsAnnVol`.
export const REGIME_BOUNDS_ANN_VOL = [0.12, 0.2, 0.35] as const;

/** Classify an annualized realized-vol reading into the gap model's regime vocabulary. */
export function classifyRegime(annVol: number): Regime {
  if (!(annVol >= 0) || !Number.isFinite(annVol)) return "normal";
  if (annVol < REGIME_BOUNDS_ANN_VOL[0]) return "calm";
  if (annVol < REGIME_BOUNDS_ANN_VOL[1]) return "normal";
  if (annVol < REGIME_BOUNDS_ANN_VOL[2]) return "elevated";
  return "crisis";
}

export function isRegime(x: unknown): x is Regime {
  return typeof x === "string" && (REGIMES as readonly string[]).includes(x);
}

export interface PublishedRegime {
  regime: Regime;
  regimeVolAnn: number | null;
  dataAsOf: string | null;
  modelVersion: string | null;
}

/**
 * Load the pipeline's published regime from risk/gap/out/reading-current.json. Returns null
 * (→ caller falls back to "normal") if the file is missing, unparseable, or carries no valid
 * regime. If a numeric `regimeVolAnn` is present it is re-classified defensively so the engine
 * and the published label can never disagree on the bounds.
 */
export function loadPublishedRegime(repoRoot: string): PublishedRegime | null {
  try {
    const raw = readFileSync(join(repoRoot, "risk", "gap", "out", "reading-current.json"), "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    const volAnn = typeof j.regimeVolAnn === "number" && Number.isFinite(j.regimeVolAnn) ? (j.regimeVolAnn as number) : null;
    let regime: Regime | null = isRegime(j.regime) ? j.regime : null;
    if (volAnn !== null) regime = classifyRegime(volAnn); // trust the number over a stale label
    if (!regime) return null;
    return {
      regime,
      regimeVolAnn: volAnn,
      dataAsOf: typeof j.dataAsOf === "string" ? j.dataAsOf : null,
      modelVersion: typeof j.modelVersion === "string" ? j.modelVersion : null,
    };
  } catch {
    return null;
  }
}
