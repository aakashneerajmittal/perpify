import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractFeatures, featureVector } from "../src/features.js";
import { loadModel, rawPredict, scoreOf, scoreTrader, tierOf, toTierReading } from "../src/score.js";
import type { RoundTrip } from "../src/types.js";

// the same gold the browser parity test uses: features.py-generated cases with vectors/raw/score
// (read from the canonical trader-dna location — one source of truth, no vendored duplicate).
const CASES = JSON.parse(
  readFileSync(new URL("../../trader-dna/train/test_cases.json", import.meta.url), "utf8"),
) as any[];
const model = loadModel();

describe("feature parity vs features.py exported cases", () => {
  it("reproduces every case's 22-feature vector to < 1e-6", () => {
    let maxErr = 0;
    let worst = "";
    for (const c of CASES) {
      const v = featureVector(extractFeatures(c.roundtrips as RoundTrip[]));
      expect(v.length).toBe(22);
      for (let j = 0; j < v.length; j++) {
        const e = Math.abs(v[j]! - c.vector[j]);
        if (e > maxErr) {
          maxErr = e;
          worst = `${c.archetype} feat[${j}] js=${v[j]} py=${c.vector[j]}`;
        }
      }
    }
    expect(maxErr, `worst=${worst}`).toBeLessThan(1e-6);
  });
});

describe("model parity vs exported raw/score", () => {
  it("reproduces the ensemble raw output and calibrated score", () => {
    let maxRawErr = 0;
    let maxScoreErr = 0;
    for (const c of CASES) {
      const raw = rawPredict(model, c.vector);
      maxRawErr = Math.max(maxRawErr, Math.abs(raw - c.raw));
      maxScoreErr = Math.max(maxScoreErr, Math.abs(scoreOf(model, raw) - c.score));
    }
    expect(maxRawErr).toBeLessThan(1e-6);
    expect(maxScoreErr).toBeLessThan(1e-4);
  });
});

describe("tier mapping + end-to-end scoring + verified-tier hand-off", () => {
  it("maps a calibrated score to the venue's tier band with matching mult", () => {
    expect(tierOf(model, 95)).toMatchObject({ tier: "A", mult: 0.75 });
    expect(tierOf(model, 50)).toMatchObject({ tier: "C", mult: 1 });
    expect(tierOf(model, 5)).toMatchObject({ tier: "E", mult: 1.45 });
  });

  it("scoreTrader reproduces a case end-to-end", () => {
    const c = CASES[0];
    const s = scoreTrader(c.roundtrips as RoundTrip[], model);
    expect(s.score).toBeCloseTo(c.score, 3);
    expect(s.tier).toBe(tierOf(model, c.score).tier);
    expect(s.factors.length).toBeGreaterThan(0);
    expect(s.archetype).toBeTruthy();
    expect(s.roundTrips).toBe(c.roundtrips.length);
  });

  it("toTierReading shapes a verified provisional tier for the engine's TierUpdate", () => {
    const s = scoreTrader(CASES[0].roundtrips as RoundTrip[], model);
    const tr = toTierReading("0xABCdef", s, model);
    expect(tr.wallet).toBe("0xabcdef");
    expect(tr.tier).toBe(s.tier);
    expect(tr.tierMult).toBe(s.tierMult);
    expect(tr.modelVersion).toContain("connect");
    expect(Array.isArray(tr.factors)).toBe(true);
  });
});
