import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRegime, isRegime, loadPublishedRegime, REGIME_BOUNDS_ANN_VOL } from "../src/risk/regime.js";
import { computeGapReading } from "../src/risk/gapCoefficient.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("regime classification", () => {
  it("maps annualized vol to the gap model's regime bands", () => {
    expect(classifyRegime(0.08)).toBe("calm");
    expect(classifyRegime(0.15)).toBe("normal");
    expect(classifyRegime(0.27)).toBe("elevated");
    expect(classifyRegime(0.60)).toBe("crisis");
  });

  it("uses bounds matching gap-v0.1 [0.12, 0.20, 0.35]", () => {
    expect(REGIME_BOUNDS_ANN_VOL).toEqual([0.12, 0.2, 0.35]);
    expect(classifyRegime(REGIME_BOUNDS_ANN_VOL[0] - 1e-9)).toBe("calm");
    expect(classifyRegime(REGIME_BOUNDS_ANN_VOL[0])).toBe("normal");
    expect(classifyRegime(REGIME_BOUNDS_ANN_VOL[2])).toBe("crisis");
  });

  it("is defensive on bad input", () => {
    expect(classifyRegime(NaN)).toBe("normal");
    expect(classifyRegime(-1)).toBe("normal");
    expect(isRegime("elevated")).toBe(true);
    expect(isRegime("meltup")).toBe(false);
  });
});

describe("published regime loading", () => {
  it("loads the pipeline's real published reading", () => {
    const p = loadPublishedRegime(repoRoot);
    // the artifact ships in the repo/image; it must parse to a valid regime
    expect(p).not.toBeNull();
    expect(isRegime(p!.regime)).toBe(true);
  });

  it("falls back to null on a missing artifact (caller → 'normal')", () => {
    expect(loadPublishedRegime("/no/such/root")).toBeNull();
  });
});

describe("regime actually moves the coefficient", () => {
  it("raises the weekend premium under stress vs calm", () => {
    // a Saturday deep in the weekend dark window
    const sat = new Date(Date.parse("2026-03-07T18:00:00Z"));
    const calm = computeGapReading(sat, "calm").gapCoefficient;
    const normal = computeGapReading(sat, "normal").gapCoefficient;
    const crisis = computeGapReading(sat, "crisis").gapCoefficient;
    expect(normal).toBeGreaterThanOrEqual(calm);
    expect(crisis).toBeGreaterThan(normal);
    expect(crisis).toBeGreaterThan(1.2);
  });
});
