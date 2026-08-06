/**
 * Trader-DNA feature extraction — a faithful TypeScript port of trader-dna/train/features.py
 * (the SINGLE SOURCE OF TRUTH). Training (Python), the browser app (JS-in-HTML), and this server
 * port MUST compute identical vectors — the exported model.json pins the feature order and every
 * consumer reads it back. Parity is asserted against the exported test_cases.json.
 */
import type { RoundTrip } from "./types.js";

export const FEATURES = [
  "sizing_median",
  "sizing_cov",
  "concentration",
  "win_rate",
  "payoff",
  "profit_factor",
  "expectancy",
  "max_drawdown",
  "downside_dev",
  "tail_loss",
  "revenge_sizing",
  "post_loss_freq",
  "disposition",
  "hold_cov",
  "overtrade",
  "turnover",
  "tenure",
  "blowup_rate",
  "grey_restraint",
  "crisis_addrisk",
  "regime_coverage",
  "beta_share",
] as const;

export type FeatureName = (typeof FEATURES)[number];
export type FeatureMap = Record<FeatureName, number>;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return s[(n - 1) / 2]!;
  return 0.5 * (s[n / 2 - 1]! + s[n / 2]!);
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function pctile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (hi - k) + s[hi]! * (k - lo);
}

/** rts: RoundTrip[] (chronological). Returns the feature map (all 22 keys). */
export function extractFeatures(rts: RoundTrip[]): FeatureMap {
  const f = Object.fromEntries(FEATURES.map((k) => [k, 0])) as FeatureMap;
  const n = rts.length;
  if (n === 0) return f;

  const eq = rts.map((r) => Math.max(1e-9, r.equity));
  const sizeFrac = rts.map((r, i) => r.notional / eq[i]!);
  const ret = rts.map((r, i) => r.pnl / eq[i]!);
  const holds = rts.map((r) => Math.max(1e-6, r.hold));

  const wins = ret.filter((x) => x > 0);
  const losses = ret.filter((x) => x < 0);

  f.sizing_median = median(sizeFrac);
  const mSz = mean(sizeFrac);
  f.sizing_cov = mSz > 1e-9 ? std(sizeFrac) / mSz : 0;
  f.concentration = Math.max(...sizeFrac);
  f.win_rate = wins.length / n;

  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 0;
  f.payoff = avgLoss > 1e-9 ? Math.min(10, avgWin / avgLoss) : wins.length ? 3 : 0;

  const gp = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  f.profit_factor = gl > 1e-9 ? Math.min(10, gp / gl) : gp > 0 ? 3 : 0;

  f.expectancy = mean(ret);

  // equity-curve drawdown from compounded per-trade returns
  let lvl = 1.0;
  let peak = -1e18;
  let mdd = 0;
  for (const x of ret) {
    lvl *= 1 + x;
    peak = Math.max(peak, lvl);
    if (peak > 0) mdd = Math.max(mdd, (peak - lvl) / peak);
  }
  f.max_drawdown = mdd;

  f.downside_dev = losses.length >= 2 ? std(losses) : losses.length ? Math.abs(losses[0]!) : 0;
  f.tail_loss = Math.abs(Math.min(0, pctile(ret, 0.05)));

  // revenge sizing: mean size after a loss vs after a win
  const afterLoss: number[] = [];
  const afterWin: number[] = [];
  for (let i = 1; i < n; i++) {
    if (ret[i - 1]! < 0) afterLoss.push(sizeFrac[i]!);
    else if (ret[i - 1]! > 0) afterWin.push(sizeFrac[i]!);
  }
  const al = mean(afterLoss);
  const aw = mean(afterWin);
  f.revenge_sizing = aw > 1e-9 ? al / aw - 1.0 : 0;

  // post-loss cadence: trades entered within 1 day of a prior loss
  let quick = 0;
  for (let i = 1; i < n; i++) {
    if (ret[i - 1]! < 0 && rts[i]!.t - rts[i - 1]!.t < 1.0) quick++;
  }
  f.post_loss_freq = quick / n;

  const loserHolds = holds.filter((_, i) => ret[i]! < 0);
  const winnerHolds = holds.filter((_, i) => ret[i]! > 0);
  const mhW = winnerHolds.length ? median(winnerHolds) : 0;
  f.disposition = loserHolds.length && mhW > 1e-9 ? Math.min(6.0, median(loserHolds) / mhW) : 1.0;

  const mH = mean(holds);
  f.hold_cov = mH > 1e-9 ? std(holds) / mH : 0;

  const span = Math.max(1e-6, rts[n - 1]!.t - rts[0]!.t) + mean(holds);
  const activeDays = Math.max(1.0, span);
  f.overtrade = n / activeDays;
  f.turnover = rts.reduce((s, r) => s + r.notional, 0) / median(eq);
  f.tenure = Math.log1p(span);
  f.blowup_rate = ret.filter((x) => x < -0.2).length / n;

  // grey-zone restraint: do they deploy less in the chop/untradeable tape?
  const greySizes = sizeFrac.filter((_, i) => rts[i]!.grey);
  const clearSizes = sizeFrac.filter((_, i) => !rts[i]!.grey);
  if (greySizes.length && clearSizes.length) {
    const g = mean(greySizes);
    const c = mean(clearSizes);
    f.grey_restraint = c > 1e-9 ? Math.max(-1.0, Math.min(1.0, 1.0 - g / c)) : 0;
  } else {
    f.grey_restraint = 0;
  }

  const calmSizes = sizeFrac.filter((_, i) => rts[i]!.vol_reg <= 1);
  const crisisSizes = sizeFrac.filter((_, i) => rts[i]!.vol_reg === 3);
  if (crisisSizes.length && calmSizes.length) {
    f.crisis_addrisk = Math.max(-1.0, Math.min(3.0, mean(crisisSizes) / mean(calmSizes) - 1.0));
  } else {
    f.crisis_addrisk = 0;
  }

  f.regime_coverage = new Set(rts.map((r) => r.vol_reg)).size / 4.0;

  // beta share: variance of (beta*mkt) over variance of returns
  const mkt = rts.map((r) => r.mkt_ret);
  const vr = std(ret) ** 2;
  const vm = std(mkt) ** 2;
  if (vr > 1e-12 && vm > 1e-12) {
    const mr = mean(ret);
    const mm = mean(mkt);
    const cov = n > 1 ? ret.reduce((s, _, i) => s + (ret[i]! - mr) * (mkt[i]! - mm), 0) / (n - 1) : 0;
    const beta = cov / vm;
    f.beta_share = Math.max(0, Math.min(1, (beta ** 2 * vm) / vr));
  } else {
    f.beta_share = 0;
  }

  return f;
}

/** ordered vector for the model, matching model.features. */
export function featureVector(f: FeatureMap): number[] {
  return FEATURES.map((k) => f[k]);
}
