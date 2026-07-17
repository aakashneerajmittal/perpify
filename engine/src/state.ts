/**
 * Engine state, canonical serialization, state roots, and the hash-chained event log.
 *
 * The conservation law (tested continuously):
 *   deposits − withdrawals == Σfree + Σreserved + Σisolated + fees + ΣunrealizedPnL(mark)
 * Cash alone is NOT conserved in a perp venue (a closer realizes PnL while the
 * counterparty's loss is still unrealized) — cash + open uPnL is. The law only stays
 * exact if open interest stays balanced, which is why the liquidation backstop makes
 * the insurance fund a real account that INHERITS positions instead of vaporizing them.
 * Getting this law right, and asserting it after every command, is most of what
 * "trust the engine" means.
 */

import { createHash } from "node:crypto";
import { createBook, type Book } from "./book.js";
import { toCoeff6 } from "./fixed.js";
import { unrealizedPnl } from "./margin.js";
import type { Account, Address, EngineEvent, EngineParams, Hex, SequencerPlan } from "./types.js";

/** the insurance fund is an ordinary account — its free balance + position equity is the fund */
export const INSURANCE_ACCOUNT: Address = "0xinsurancefund";

export interface EngineState {
  params: EngineParams;
  seq: number;
  book: Book;
  accounts: Map<Address, Account>;
  indexPx8: bigint; // 0n until first oracle tick
  markPx8: bigint; // last trade price (snapped to index if >5% stale-drift)
  gapCoeff6: bigint;
  gapModelVersion: string;
  confidence: number;
  reduceOnly: boolean;
  feePool6: bigint;
  totalDeposited6: bigint;
  totalWithdrawn6: bigint;
  pendingPlan: SequencerPlan | null;
  epochId: number;
  eventHead: Hex; // hash chain head
  eventCount: number;
}

export const DEFAULT_PARAMS: EngineParams = {
  market: "SPX-PERP",
  baseImBps: 3333, // ≈ 3x initial leverage baseline (Playbook V1 launch cap)
  baseMmBps: 1667,
  mmFloorBps: 100, // MM never below 1% of notional
  takerFeeBps: 5, // 0.05% taker (testnet placeholder)
  liqPenaltyBps: 100, // 1% liquidation penalty → insurance fund
  fundingClampBps: 75, // hourly funding rate clamp
  maxLeverageByTier: { A: 4, B: 3, C: 3, D: 2, E: 2 },
  oiCapUsd6: 1_000_000_000_000n, // $1M (usd6)
};

export function createEngine(params: EngineParams = DEFAULT_PARAMS, insuranceSeed6 = 0n): EngineState {
  const s: EngineState = {
    params,
    seq: 0,
    book: createBook(),
    accounts: new Map(),
    indexPx8: 0n,
    markPx8: 0n,
    gapCoeff6: toCoeff6(1.0),
    gapModelVersion: "gap-v0.0-unset",
    confidence: 1.0,
    reduceOnly: false,
    feePool6: 0n,
    totalDeposited6: 0n,
    totalWithdrawn6: 0n,
    pendingPlan: null,
    epochId: 0,
    eventHead: "0x" + "00".repeat(32),
    eventCount: 0,
  };
  if (insuranceSeed6 > 0n) {
    const ins = getOrCreateAccount(s, INSURANCE_ACCOUNT);
    ins.free = insuranceSeed6;
    s.totalDeposited6 = insuranceSeed6;
  }
  return s;
}

export function getOrCreateAccount(s: EngineState, owner: Address): Account {
  let a = s.accounts.get(owner);
  if (!a) {
    a = { owner, free: 0n, reserved: 0n, position: null, tier: null, lastNonce: -1 };
    s.accounts.set(owner, a);
  }
  return a;
}

// ---------- canonical serialization (deterministic across runs) ----------

function canonicalize(v: unknown): unknown {
  if (typeof v === "bigint") return `bi:${v.toString()}`;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v instanceof Map) {
    return [...v.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, canonicalize(val)]);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = canonicalize((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonicalize(v));
}

export function sha256Hex(s: string): Hex {
  return "0x" + createHash("sha256").update(s).digest("hex");
}

/** Merkle-less v0 state root: hash of canonical account+fund state. Same log in → same root out. */
export function stateRoot(s: EngineState): Hex {
  return sha256Hex(
    canonicalJson({
      accounts: s.accounts,
      fees: s.feePool6,
      deposited: s.totalDeposited6,
      withdrawn: s.totalWithdrawn6,
      mark: s.markPx8,
      seq: s.seq,
    }),
  );
}

export function chainEvent(s: EngineState, ev: EngineEvent): void {
  s.eventHead = sha256Hex(s.eventHead + canonicalJson(ev));
  s.eventCount++;
}

// ---------- conservation law ----------

export interface ConservationReport {
  holds: boolean;
  lhs: bigint; // deposits − withdrawals
  rhs: bigint; // Σcash + fees + ΣuPnL
  driftAbs: bigint;
}

/**
 * deposits − withdrawals == Σfree + Σreserved + Σisolated + fees + ΣuPnL(mark).
 * Integer division in fills/funding can leave dust; tolerance is a few units of 1e-6 USD
 * per event, asserted tightly in tests.
 */
export function checkConservation(s: EngineState, tolerancePerEvent6 = 2n): ConservationReport {
  let cash = s.feePool6;
  let upnl = 0n;
  for (const a of s.accounts.values()) {
    cash += a.free + a.reserved;
    if (a.position) {
      cash += a.position.isolatedCollateral;
      upnl += unrealizedPnl(a.position, s.markPx8);
    }
  }
  const lhs = s.totalDeposited6 - s.totalWithdrawn6;
  const rhs = cash + upnl;
  const drift = lhs - rhs;
  const driftAbs = drift < 0n ? -drift : drift;
  const tolerance = tolerancePerEvent6 * BigInt(Math.max(1, s.eventCount));
  return { holds: driftAbs <= tolerance, lhs, rhs, driftAbs };
}
