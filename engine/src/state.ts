/**
 * Engine state, canonical serialization, state roots, and the hash-chained event log.
 *
 * Multi-market (V2): the venue runs several independent markets (SPX-PERP + single-stock
 * perps) in ONE deterministic state machine. Each market has its own order book, oracle
 * index/mark, and gap coefficient; each account has ONE cross-collateral balance and at
 * most one isolated position PER market. Widening from a single market to a registry is a
 * data-shape change — the accounting laws below are unchanged.
 *
 * The conservation law (tested continuously):
 *   deposits − withdrawals == Σfree + Σreserved + Σisolated + fees + ΣunrealizedPnL(mark)
 * summed over EVERY position in EVERY market (each valued at its own market's mark). Cash
 * alone is NOT conserved in a perp venue (a closer realizes PnL while the counterparty's
 * loss is still unrealized) — cash + open uPnL is. The law only stays exact if open
 * interest stays balanced per market, which is why the liquidation backstop makes the
 * insurance fund a real account that INHERITS positions instead of vaporizing them.
 * Getting this law right, and asserting it after every command, is most of what
 * "trust the engine" means.
 */

import { createHash } from "node:crypto";
import { createBook, type Book } from "./book.js";
import { toCoeff6 } from "./fixed.js";
import { unrealizedPnl } from "./margin.js";
import type { Account, Address, EngineEvent, EngineParams, Hex, MarketId, SequencerPlan, TriggerOrder } from "./types.js";

/** the insurance fund is an ordinary account — its free balance + position equity is the fund */
export const INSURANCE_ACCOUNT: Address = "0xinsurancefund";

/** everything specific to one market — its own book, oracle, mark, and risk coefficient */
export interface MarketState {
  params: EngineParams;
  book: Book;
  indexPx8: bigint; // 0n until first oracle tick
  markPx8: bigint; // last trade price (snapped to index if >0.5% stale-drift)
  gapCoeff6: bigint;
  gapModelVersion: string;
  confidence: number;
  reduceOnly: boolean;
  /** armed conditional (TP/SL/stop) orders; hold no collateral until they fire */
  triggers: Map<string, TriggerOrder>;
}

export interface EngineState {
  markets: Map<MarketId, MarketState>;
  seq: number;
  accounts: Map<Address, Account>;
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

/** The venue's markets: the S&P 500 index perp + the 5 largest US companies by market cap. */
export const MARKET_IDS: MarketId[] = ["SPX-PERP", "NVDA-PERP", "AAPL-PERP", "MSFT-PERP", "GOOGL-PERP", "AMZN-PERP"];

/** per-market params — identical risk config today, but a real knob for per-symbol tuning */
export function paramsForMarket(market: MarketId): EngineParams {
  return { ...DEFAULT_PARAMS, market };
}

function createMarket(params: EngineParams): MarketState {
  return {
    params,
    book: createBook(),
    indexPx8: 0n,
    markPx8: 0n,
    gapCoeff6: toCoeff6(1.0),
    gapModelVersion: "gap-v0.0-unset",
    confidence: 1.0,
    reduceOnly: false,
    triggers: new Map(),
  };
}

/**
 * Build a fresh engine. `marketParams` defaults to the full 6-market set; pass a subset
 * (e.g. just SPX-PERP) for focused tests. `insuranceSeed6` seeds the insurance fund.
 */
export function createEngine(
  marketParams: EngineParams[] = MARKET_IDS.map(paramsForMarket),
  insuranceSeed6 = 0n,
): EngineState {
  const markets = new Map<MarketId, MarketState>();
  for (const p of marketParams) markets.set(p.market, createMarket(p));
  const s: EngineState = {
    markets,
    seq: 0,
    accounts: new Map(),
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

/** market accessor — throws on an unknown id (a programming error, never a user input path) */
export function marketState(s: EngineState, market: MarketId): MarketState {
  const m = s.markets.get(market);
  if (!m) throw new Error(`unknown market ${market}`);
  return m;
}

export function getOrCreateAccount(s: EngineState, owner: Address): Account {
  let a = s.accounts.get(owner);
  if (!a) {
    a = {
      owner,
      free: 0n,
      reserved: 0n,
      positions: new Map(),
      tier: null,
      lastNonce: -1,
      realizedPnl6: 0n,
      behavior: {
        trades: 0,
        liquidations: 0,
        volumeUsd6: 0n,
        fundedUsd6: 0n,
        firstSeenSeq: s.seq,
        stressVolumeUsd6: 0n,
        stressTrades: 0,
        roundTrips: 0,
        winners: 0,
        losers: 0,
        sumWinHoldSeq: 0,
        sumLossHoldSeq: 0,
        sumRMultiple6: 0n,
        sumMaeRatio6: 0n,
        lastLossNotional6: 0n,
        revengeEvents: 0,
        revengeStressEvents: 0,
      },
    };
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

/** Merkle-less v0 state root: hash of canonical account+fund state + every market's mark.
 *  Same log in → same root out (accounts carry per-market positions; marks pinned here). */
export function stateRoot(s: EngineState): Hex {
  const marks: Record<string, string> = {};
  for (const [id, m] of [...s.markets.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) marks[id] = m.markPx8.toString();
  return sha256Hex(
    canonicalJson({
      accounts: s.accounts,
      fees: s.feePool6,
      deposited: s.totalDeposited6,
      withdrawn: s.totalWithdrawn6,
      marks,
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
 * deposits − withdrawals == Σfree + Σreserved + Σisolated + fees + ΣuPnL(mark),
 * summed over every position in every market at that market's own mark.
 * Integer division in fills/funding can leave dust; tolerance is a few units of 1e-6 USD
 * per event, asserted tightly in tests.
 */
export function checkConservation(s: EngineState, tolerancePerEvent6 = 2n): ConservationReport {
  let cash = s.feePool6;
  let upnl = 0n;
  for (const a of s.accounts.values()) {
    cash += a.free + a.reserved;
    for (const pos of a.positions.values()) {
      cash += pos.isolatedCollateral;
      upnl += unrealizedPnl(pos, marketState(s, pos.market).markPx8);
    }
  }
  const lhs = s.totalDeposited6 - s.totalWithdrawn6;
  const rhs = cash + upnl;
  const drift = lhs - rhs;
  const driftAbs = drift < 0n ? -drift : drift;
  const tolerance = tolerancePerEvent6 * BigInt(Math.max(1, s.eventCount));
  return { holds: driftAbs <= tolerance, lhs, rhs, driftAbs };
}
