// Parity: gapModel (frontend port) vs engine gapCoefficient, across a full week.
// Run: engine/node_modules/.bin/tsx apps/trade/src/frontend-BL/gap/gapModel.parity.mjs
import { computeGapReading as fe, forwardCurve, nextDark, positionImpact } from "./gapModel.ts";
import { computeGapReading as eng } from "../../../../../engine/src/risk/gapCoefficient.ts";

let maxDiff = 0, worst = "";
// sweep a week at 7-minute steps, from a fixed Sunday 00:00 UTC anchor
const t0 = Date.parse("2026-03-01T00:00:00Z"); // a Sunday
for (let min = 0; min < 8 * 24 * 60; min += 7) {
  const d = new Date(t0 + min * 60000);
  const a = fe(d, "normal", 1.0).gapCoefficient;
  const b = eng(d, "normal", 1.0).gapCoefficient;
  const diff = Math.abs(a - b);
  if (diff > maxDiff) { maxDiff = diff; worst = d.toISOString(); }
  // also test a scaled symbol (NVDA 2.0)
  const a2 = fe(d, "normal", 2.0).gapCoefficient;
  const b2 = eng(d, "normal", 2.0).gapCoefficient;
  if (Math.abs(a2 - b2) > maxDiff) { maxDiff = Math.abs(a2 - b2); worst = d.toISOString() + " (scale2)"; }
}
console.log(`parity sweep: max |fe - engine| = ${maxDiff.toExponential(3)}  (worst ${worst})`);

// shape sanity on the forward curve from a Friday mid-session
const fri = new Date(Date.parse("2026-03-06T18:00:00Z")); // Fri ~13:00 ET
const curve = forwardCurve(fri, 96, 30, "normal", 1.0);
const coeffs = curve.map((c) => c.coeff);
const peak = Math.max(...coeffs), trough = Math.min(...coeffs);
const nd = nextDark(fri, "normal", 1.0);
const imp = positionImpact(50000, 1.0, nd.coeffAtDark, 0.9);
console.log(`forward curve (96h): trough=${trough.toFixed(3)} peak=${peak.toFixed(3)} points=${curve.length}`);
console.log(`nextDark: ${nd.label} in ${nd.opensInHours.toFixed(1)}h · ${nd.darkType} · coeff->${nd.coeffAtDark.toFixed(3)}`);
console.log(`$50k position @ tierB: margin +$${imp.extra.toFixed(0)} when the dark opens`);

const ok = maxDiff < 1e-9 && peak > 1.05 && trough <= 1.0001 && curve.length > 100 && nd && imp.extra > 0;
console.log(ok ? "GAP MODEL: PASS ✓" : "GAP MODEL: FAIL ✗");
process.exit(ok ? 0 : 1);
