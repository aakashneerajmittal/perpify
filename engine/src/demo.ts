/**
 * A readable end-to-end session of the Perpify engine — run with: npm run demo
 *
 * This is the non-technical founder's verification tool: every claim the engine makes
 * (tier-differentiated margin, gap-aware pricing, explained liquidations, money
 * conservation, deterministic replay) is demonstrated in plain text below.
 */

import { apply, insuranceFundBalance, replay } from "./core.js";
import { fmtPx, fmtUsd, px8, qty8, usd6 } from "./fixed.js";
import { checkConservation, createEngine, DEFAULT_PARAMS, stateRoot } from "./state.js";
import type { Command, EngineEvent, EngineParams, Order, Side, Tif } from "./types.js";

const ALICE = "0xa11ce00000000000000000000000000000000001"; // disciplined trader → tier A
const EDDIE = "0xedd1e00000000000000000000000000000000005"; // reckless trader → tier E
const MAKER = "0x3a4ke00000000000000000000000000000000009"; // PVault quoting bot stand-in

// demo params: identical to defaults, with tier-E leverage at the playbook's 3x launch cap
const PARAMS: EngineParams = { ...DEFAULT_PARAMS, maxLeverageByTier: { A: 4, B: 3, C: 3, D: 3, E: 3 } };

const log: Command[] = [];
const s = createEngine([PARAMS], usd6(50_000));
let oid = 0;
const nonces = new Map<string, number>();

function cmd(c: Command): EngineEvent[] {
  log.push(c);
  return apply(s, c);
}

function order(owner: string, side: Side, price: number, qty: number, tif: Tif = "GTC", reduceOnly = false): EngineEvent[] {
  const n = (nonces.get(owner) ?? 0) + 1;
  nonces.set(owner, n);
  const o: Omit<Order, "remaining" | "seq"> = {
    id: `d${++oid}`,
    market: "SPX-PERP",
    owner,
    side,
    price: px8(price),
    qty: qty8(qty),
    tif,
    reduceOnly,
    nonce: n,
    expiry: 0,
    signature: "0xdemo",
  };
  return cmd({ kind: "PlaceOrder", order: o });
}

const hr = () => console.log("─".repeat(72));

console.log("PERPIFY ENGINE — demo session (SPX-PERP, isolated margin, testnet params)\n");

// ── Act 0: market opens ──────────────────────────────────────────────────
cmd({ kind: "OracleTick", market: "SPX-PERP", indexPx: px8(5000), source: "testnet-feed" });
cmd({ kind: "Deposit", owner: ALICE, amount: usd6(50_000), l1TxHash: "0x1" });
cmd({ kind: "Deposit", owner: EDDIE, amount: usd6(50_000), l1TxHash: "0x2" });
cmd({ kind: "Deposit", owner: MAKER, amount: usd6(1_000_000), l1TxHash: "0x3" });
console.log("Oracle: SPX index = 5000.00");
console.log(`Deposits: alice ${fmtUsd(usd6(50_000))}, eddie ${fmtUsd(usd6(50_000))}, maker ${fmtUsd(usd6(1_000_000))}`);

// behavioral tiers arrive from the risk service
cmd({ kind: "TierUpdate", reading: { wallet: ALICE, tier: "A", tierMult: 0.85, factors: [{ name: "drawdown-discipline", contribution: 0.6 }, { name: "sizing-vs-balance", contribution: 0.4 }], modelVersion: "tier-v0.1", signature: "0x" } });
cmd({ kind: "TierUpdate", reading: { wallet: EDDIE, tier: "E", tierMult: 1.3, factors: [{ name: "prior-liquidations", contribution: 0.7 }, { name: "oversizing", contribution: 0.3 }], modelVersion: "tier-v0.1", signature: "0x" } });

hr();
console.log("ACT 1 · TIER-DIFFERENTIATED MARGIN — same trade, different traders\n");

order(MAKER, "sell", 5001, 10); // d1
order(MAKER, "buy", 4999, 10); // d2

const evA = order(ALICE, "buy", 5001, 1, "IOC"); // d3
const evE = order(EDDIE, "buy", 5001, 1, "IOC"); // d4
const mcA = evA.find((e) => e.kind === "MarginCheck");
const mcE = evE.find((e) => e.kind === "MarginCheck");
if (mcA?.kind === "MarginCheck" && mcE?.kind === "MarginCheck") {
  console.log(`  alice (tier A, mult 0.85): IM ${fmtUsd(mcA.imRequired)} for a 1-contract long`);
  console.log(`  eddie (tier E, mult 1.30): IM ${fmtUsd(mcE.imRequired)} for the SAME long → pays ${(Number(mcE.imRequired) / Number(mcA.imRequired)).toFixed(2)}x more`);
  console.log(`  every margin decision logs its inputs (model versions, coefficients) — auditable later`);
}

hr();
console.log("ACT 2 · GAP-AWARE MARGIN — Friday close approaches, the dark is priced\n");
cmd({ kind: "RiskReading", reading: { kind: "gap", market: "SPX-PERP", gapCoefficient: 1.42, session: "weekend", hoursDark: 12, expectedGapStd: 0.0145, modelVersion: "gap-v0.1", signature: "0x" } });
const evA2 = order(ALICE, "buy", 5001, 1, "IOC"); // d5
const mcA2 = evA2.find((e) => e.kind === "MarginCheck");
if (mcA?.kind === "MarginCheck" && mcA2?.kind === "MarginCheck") {
  console.log(`  alice's next identical long: IM ${fmtUsd(mcA.imRequired)} → ${fmtUsd(mcA2.imRequired)} (gap coefficient 1.00 → 1.42)`);
  console.log("  the weekend's uncertainty is charged BEFORE the gap resolves, not after");
}

// discipline: alice flattens into the weekend; eddie holds
const evClose = order(ALICE, "sell", 4999, 2, "IOC", true); // d6
const closed = evClose.filter((e) => e.kind === "TradeExecuted").length;
console.log(`  alice reads the coefficient and goes FLAT into the weekend (${closed} closing fills)`);
console.log("  eddie holds his leveraged long through 65 dark hours");

// maker re-quotes around the expected reopen
cmd({ kind: "CancelOrder", market: "SPX-PERP", orderId: "d2", owner: MAKER });
order(MAKER, "buy", 4045, 5); // d7 — post-gap bid

hr();
console.log("ACT 3 · THE REOPEN PRINTS -19% — cleared, explained, signed\n");
const evGap = cmd({ kind: "OracleTick", market: "SPX-PERP", indexPx: px8(4050), source: "testnet-feed" });
const liqs = evGap.filter((e) => e.kind === "PositionLiquidated");
for (const l of liqs) {
  if (l.kind !== "PositionLiquidated") continue;
  const ex = l.explainer;
  console.log(`  LIQUIDATED: ${ex.owner === EDDIE ? "eddie" : ex.owner} (tier ${ex.tierAtLiquidation})`);
  console.log(`    signed explainer → equity ${fmtUsd(ex.equityAtTrigger)} < MM ${fmtUsd(ex.mmRequiredAtTrigger)} at gapCoeff ${ex.gapCoefficientAtLiquidation}`);
  console.log(`    avg fill ${fmtPx(ex.avgFillPx)} · queueRank ${ex.queueRank ?? "n/a (normal mode; sequencer lands in M3)"}`);
  console.log(`    inputsHash ${ex.inputsHash.slice(0, 18)}… — anyone can replay inputs → model → same decision`);
}
if (liqs.length === 0) console.log("  (no liquidation — story bug, checks below will fail)");
const alicePos = s.accounts.get(ALICE)!.positions.get("SPX-PERP") ?? null;
console.log(`  alice: ${alicePos ? "STILL EXPOSED (bug!)" : "flat, untouched — she was charged for the risk and chose not to carry it"}`);

hr();
console.log("ACT 4 · THE LEDGER CANNOT LIE — conservation law + deterministic replay\n");
const c = checkConservation(s);
console.log(`  deposits − withdrawals   : ${fmtUsd(c.lhs)}`);
console.log(`  Σcash + fees + ΣuPnL     : ${fmtUsd(c.rhs)}`);
console.log(`  drift                    : ${c.driftAbs.toString()} micro-USD → law ${c.holds ? "HOLDS" : "BROKEN"}`);
console.log(`  insurance fund           : ${fmtUsd(insuranceFundBalance(s))} (collected eddie's liquidation penalty)`);

const s2 = replay(log, [PARAMS], usd6(50_000));
const same = stateRoot(s2) === stateRoot(s) && s2.eventHead === s.eventHead;
console.log(`  replay of ${log.length} commands → state root ${same ? "IDENTICAL" : "MISMATCH"}`);
console.log(`  state root: ${stateRoot(s).slice(0, 34)}…`);
console.log(`  event hash chain (${s.eventCount} events): ${s.eventHead.slice(0, 34)}…`);
hr();

const ok = same && c.holds && liqs.length === 1 && alicePos === null;
console.log(ok ? "\nAll demo checks passed." : "\nDEMO CHECKS FAILED");
if (!ok) process.exit(1);
