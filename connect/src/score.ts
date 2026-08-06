/**
 * Trader-DNA scoring — TS port of the browser app's inference (rawPredict / scoreOf / tierOf /
 * nearestArchetype), reading the exported model.json. The GBT trees operate on the RAW feature
 * vector (their thresholds are in raw units); only the archetype centroid distance is standardized.
 * Scores are calibrated to 0–100 and mapped to a tier (A–E) whose margin multiplier matches the
 * venue's own TIER_MULT — so a connected trader's verified provisional tier plugs straight into the
 * engine's TierUpdate path.
 */
import { readFileSync } from "node:fs";
import { extractFeatures, featureVector, FEATURES } from "./features.js";
import type { RoundTrip } from "./types.js";

interface Tree {
  feat: number[];
  thr: number[];
  left: number[];
  right: number[];
  val: number[];
}
export interface DnaModel {
  modelVersion: string;
  features: string[];
  featureMean: number[];
  featureStd: number[];
  model: { base: number; learningRate: number; trees: Tree[] };
  calibration: { raw: number[]; pct: number[] };
  tiers: { tier: string; min: number; mult: number }[];
  archetypes: { name: string; desc?: string; centroid: number[]; meanScore?: number }[];
}

export interface TierFactor {
  name: string;
  contribution: number;
}
export interface ScoredTrader {
  score: number; // 0–100 calibrated
  raw: number; // pre-calibration ensemble output
  tier: string; // A–E
  tierMult: number; // margin multiplier (matches venue TIER_MULT)
  archetype: string;
  archetypeDesc: string;
  factors: TierFactor[]; // top signed attributions, human-named
  vector: number[]; // the 22-feature vector
  roundTrips: number;
}

let cached: DnaModel | null = null;

/** Load a Trader-DNA model. Defaults to the vendored dna-v0.1 model shipped with this package. */
export function loadModel(path?: string): DnaModel {
  if (!path && cached) return cached;
  const url = path ?? new URL("../model/dna-v0.1.json", import.meta.url);
  const m = JSON.parse(readFileSync(url as any, "utf8")) as DnaModel;
  if (!path) cached = m;
  return m;
}

/** ensemble walk on the RAW feature vector. */
export function rawPredict(model: DnaModel, x: number[]): number {
  let raw = model.model.base;
  const lr = model.model.learningRate;
  for (const t of model.model.trees) {
    let node = 0;
    while (t.left[node] !== -1) node = x[t.feat[node]!]! <= t.thr[node]! ? t.left[node]! : t.right[node]!;
    raw += lr * t.val[node]!;
  }
  return raw;
}

/** piecewise-linear interpolation (calibration curve). */
function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
  return ys[lo]! + t * (ys[hi]! - ys[lo]!);
}

export function scoreOf(model: DnaModel, raw: number): number {
  return Math.max(0, Math.min(100, 100 * interp(raw, model.calibration.raw, model.calibration.pct)));
}

/** first tier whose `min` the score clears (tiers are ordered high→low). */
export function tierOf(model: DnaModel, score: number): { tier: string; min: number; mult: number } {
  for (const t of model.tiers) if (score >= t.min) return t;
  return model.tiers[model.tiers.length - 1]!;
}

/** per-feature raw-unit contribution (Saabas path attribution); sum + base == raw. */
export function attribution(model: DnaModel, x: number[]): number[] {
  const lr = model.model.learningRate;
  const attr = new Array(model.features.length).fill(0);
  for (const t of model.model.trees) {
    let node = 0;
    while (t.left[node] !== -1) {
      const fe = t.feat[node]!;
      const child = x[fe]! <= t.thr[node]! ? t.left[node]! : t.right[node]!;
      attr[fe] += lr * (t.val[child]! - t.val[node]!);
      node = child;
    }
  }
  return attr;
}

function standardize(model: DnaModel, x: number[]): number[] {
  return x.map((v, j) => (v - model.featureMean[j]!) / model.featureStd[j]!);
}

export function nearestArchetype(model: DnaModel, x: number[]): { name: string; desc: string } {
  const z = standardize(model, x);
  let best = model.archetypes[0]!;
  let bd = Infinity;
  for (const a of model.archetypes) {
    let d = 0;
    for (let j = 0; j < z.length; j++) {
      const e = z[j]! - a.centroid[j]!;
      d += e * e;
    }
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return { name: best.name, desc: best.desc ?? "" };
}

const prettyFeature = (n: string) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Top signed attributions as human-named factors, normalized so |contributions| sum to ~1. */
function topFactors(model: DnaModel, x: number[], k = 4): TierFactor[] {
  const attr = attribution(model, x);
  const total = attr.reduce((s, a) => s + Math.abs(a), 0) || 1;
  return attr
    .map((a, j) => ({ name: prettyFeature(model.features[j]!), contribution: a / total }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, k)
    .map((f) => ({ name: f.name, contribution: Math.round(f.contribution * 100) / 100 }));
}

/** Score a reconstructed history end to end: features → model → calibrated score → tier + archetype. */
export function scoreTrader(roundTrips: RoundTrip[], model: DnaModel = loadModel()): ScoredTrader {
  const vector = featureVector(extractFeatures(roundTrips));
  const raw = rawPredict(model, vector);
  const score = scoreOf(model, raw);
  const t = tierOf(model, score);
  const arch = nearestArchetype(model, vector);
  return {
    score,
    raw,
    tier: t.tier,
    tierMult: t.mult,
    archetype: arch.name,
    archetypeDesc: arch.desc,
    factors: topFactors(model, vector),
    vector,
    roundTrips: roundTrips.length,
  };
}

/**
 * Shape a scored trader into the engine's TierReading — the *verified provisional* tier a connected
 * trader carries onto the venue. modelVersion is namespaced so the engine can tell a connect-derived
 * tier from an on-venue one; the signature is a testnet stub (real attestation is the venue's job).
 */
export function toTierReading(wallet: string, scored: ScoredTrader, model: DnaModel = loadModel()) {
  return {
    wallet: wallet.toLowerCase(),
    tier: scored.tier,
    tierMult: scored.tierMult,
    factors: scored.factors,
    modelVersion: `${model.modelVersion}-connect`,
    signature: "0xconnect-verified",
  };
}
