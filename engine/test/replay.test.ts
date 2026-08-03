import { describe, expect, it } from "vitest";
import { runMar2020Replay } from "../src/replay-mar2020.js";

describe("March 2020 replay (Perpify vs naive)", () => {
  it("Perpify prices the dark, takes far less bad debt, and stays solvent while the naive venue breaks", () => {
    const r = runMar2020Replay();
    expect(r.naive.badDebt).toBeGreaterThan(0); // the gap creates bad debt
    expect(r.perpify.badDebt).toBeLessThan(r.naive.badDebt); // gap-aware margin absorbs more
    expect(r.badDebtReductionPct).toBeGreaterThan(40);
    expect(r.naive.insolvent).toBe(true); // naive insurance fund is wiped
    expect(r.perpify.insolvent).toBe(false); // Perpify survives
    expect(r.perpify.insuranceEnd).toBeGreaterThan(r.naive.insuranceEnd);
    // the ledger stays honest in both venues even through insolvency
    expect(r.naive.conservationHolds).toBe(true);
    expect(r.perpify.conservationHolds).toBe(true);
    // a published, hashed clearing plan is produced
    expect(r.clearingPlan.length).toBeGreaterThan(0);
    expect(r.planHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
