/**
 * March-2020 replay — the fundraise showpiece (Architecture §10, M3).
 *
 * Runs the REAL SPY crash (Mar 6 2020 close → Mar 16 weekend gap, ~-19%, prices ×10 to match
 * SPX-PERP) through TWO venues on the same engine:
 *   • Naive venue    — 10x flat margin, no gap pricing (what everyone else runs).
 *   • Perpify        — same 10x, but the weekend gap coefficient (×1.6) was charged into the
 *                      dark BEFORE the gap, so positions held more collateral (~6x effective).
 * Same traders, same size, same crash. We measure bad debt and the insurance fund. Perpify
 * "prices the dark" and survives; the naive venue takes bad debt and goes insolvent.
 *
 * Run:  npx tsx src/replay-mar2020.ts   → prints the comparison + writes the FE artifact.
 * Also exported as runMar2020Replay() for the test and the frontend.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, insuranceFundBalance } from "./core.js";
import { createEngine, DEFAULT_PARAMS, checkConservation } from "./state.js";
import { px8, qty8, usd6 } from "./fixed.js";
import { planReopen, type ReopenCandidate } from "./risk/sequencer.js";
import type { Command, EngineEvent, EngineParams } from "./types.js";

const ENTRY = 2975; // 2020-03-06 SPY close (297.46) ×10
const GAP_TO = 2398; // 2020-03-16 open-gap level (239.85) ×10 — the Monday weekend gap
const N_TRADERS = 20;
const INSURANCE_SEED = 4000;

const trader = (i: number): string => "0x" + (0xd00 + i).toString(16).padStart(40, "0");
const MAKER = "0x" + "aa".padEnd(40, "0");

interface VenueResult {
  label: string;
  gapCoeff: number;
  effectiveMarginPct: number;
  badDebt: number;
  liquidations: number;
  insuranceStart: number;
  insuranceEnd: number;
  insolvent: boolean;
  conservationHolds: boolean;
}

const sumBadDebt = (evs: EngineEvent[]): number => {
  let x = 0;
  for (const e of evs) if (e.kind === "BadDebt") x += Number(e.amount) / 1e6;
  return x;
};

function runVenue(label: string, baseImBps: number, baseMmBps: number, gapCoeff: number): VenueResult {
  const params: EngineParams = { ...DEFAULT_PARAMS, baseImBps, baseMmBps, maxLeverageByTier: { A: 20, B: 20, C: 20, D: 20, E: 20 } };
  const s = createEngine([params], usd6(INSURANCE_SEED));
  const log: EngineEvent[] = [];
  const run = (c: Command) => {
    for (const e of apply(s, c)) log.push(e);
  };

  run({ kind: "OracleTick", market: "SPX-PERP", indexPx: px8(ENTRY), source: "testnet-feed" });
  run({
    kind: "RiskReading",
    reading: { kind: "gap", market: "SPX-PERP", gapCoefficient: gapCoeff, session: "weekend", hoursDark: 65.5, expectedGapStd: 0, modelVersion: "gap-v0.1", signature: "0x" },
  });
  // deep ask so traders can open; NO bids below entry → the weekend gap has no liquidity (the crash)
  run({ kind: "Deposit", owner: MAKER, amount: usd6(50_000_000), l1TxHash: "0x" });
  run({ kind: "PlaceOrder", order: { id: "mk-ask", market: "SPX-PERP", owner: MAKER, side: "sell", price: px8(ENTRY), qty: qty8(N_TRADERS + 1), tif: "GTC", reduceOnly: false, nonce: 1, expiry: 0, signature: "0x" } });

  for (let i = 0; i < N_TRADERS; i++) {
    const t = trader(i);
    run({ kind: "Deposit", owner: t, amount: usd6(2000), l1TxHash: "0x" });
    run({ kind: "PlaceOrder", order: { id: `t${i}`, market: "SPX-PERP", owner: t, side: "buy", price: px8(ENTRY * 1.01), qty: qty8(1), tif: "IOC", reduceOnly: false, nonce: 1, expiry: 0, signature: "0x" } });
  }
  log.length = 0; // measure only the gap's damage

  // THE GAP: one weekend-reopen tick straight down (no in-between liquidity)
  run({ kind: "OracleTick", market: "SPX-PERP", indexPx: px8(GAP_TO), source: "testnet-feed" });

  const badDebt = sumBadDebt(log);
  const liquidations = log.filter((e) => e.kind === "PositionLiquidated").length;
  const insuranceEnd = Number(insuranceFundBalance(s)) / 1e6;
  return {
    label,
    gapCoeff,
    effectiveMarginPct: Math.round((baseImBps / 100) * gapCoeff * 10) / 10,
    badDebt: Math.round(badDebt),
    liquidations,
    insuranceStart: INSURANCE_SEED,
    insuranceEnd: Math.round(insuranceEnd),
    insolvent: insuranceEnd < 0,
    conservationHolds: checkConservation(s).holds,
  };
}

export function runMar2020Replay() {
  const naive = runVenue("Naive venue — 10x flat, no gap pricing", 1000, 500, 1.0);
  const perpify = runVenue("Perpify — 10x × weekend gap 1.6 (~6x effective)", 1000, 500, 1.6);

  // illustrative published clearing plan (scored order the sequencer would clear in)
  const cands: ReopenCandidate[] = Array.from({ length: 8 }, (_, i) => ({
    owner: trader(i),
    tierRank: i % 5,
    shortfallUsd6: usd6(40 * (i % 5) + 15),
    notionalUsd6: usd6(GAP_TO),
  }));
  const plan = planReopen("SPX-PERP", cands, px8(GAP_TO * 0.97), px8(GAP_TO * 1.03));

  return {
    scenario: "March 2020 — real SPY daily closes ×10 (Mar 6 close → Mar 16 weekend gap)",
    entryPx: ENTRY,
    gapToPx: GAP_TO,
    gapPct: Math.round((GAP_TO / ENTRY - 1) * 1000) / 10,
    traders: N_TRADERS,
    insuranceSeed: INSURANCE_SEED,
    naive,
    perpify,
    badDebtReductionPct: naive.badDebt > 0 ? Math.round((1 - perpify.badDebt / naive.badDebt) * 100) : 0,
    verdict: perpify.insolvent
      ? "both insolvent"
      : naive.insolvent
        ? "Perpify solvent — naive venue INSOLVENT"
        : "both solvent (Perpify with far less bad debt)",
    pricePath: [
      { date: "2020-03-06", px: 2975 },
      { date: "2020-03-09", px: 2742 },
      { date: "2020-03-12", px: 2481 },
      { date: "2020-03-16", px: 2398 },
    ],
    clearingPlan: plan.entries,
    planHash: plan.publishedHash,
    modelVersions: { gap: "gap-v0.1", sequencer: plan.modelVersion },
  };
}

// CLI: print + write the frontend artifact
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runMar2020Replay();
  const line = (v: VenueResult) =>
    `  ${v.label}\n    effective margin ${v.effectiveMarginPct}% · bad debt $${v.badDebt} · liquidations ${v.liquidations} · insurance $${v.insuranceStart}→$${v.insuranceEnd} ${v.insolvent ? "❌ INSOLVENT" : "✅ solvent"}`;
  console.log(`\nMARCH 2020 REPLAY — ${r.scenario}`);
  console.log(`Entry ${r.entryPx} → gap ${r.gapToPx} (${r.gapPct}%), ${r.traders} traders, insurance seed $${r.insuranceSeed}\n`);
  console.log(line(r.naive));
  console.log(line(r.perpify));
  console.log(`\n  → Perpify bad debt is ${r.badDebtReductionPct}% lower. Verdict: ${r.verdict}`);
  console.log(`  → clearing plan hash ${r.planHash.slice(0, 18)}… (seq-v0.1)\n`);

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outDir = join(repoRoot, "apps", "trade", "public");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "mar2020-replay.json"), JSON.stringify(r, null, 2));
  console.log(`  wrote apps/trade/public/mar2020-replay.json`);
}
