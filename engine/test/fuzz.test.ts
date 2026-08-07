/**
 * Property fuzz — the existential invariants under random, adversarial, multi-market pressure.
 * A deterministic LCG drives random orders, oracle moves, violent gaps, funding, and oracle-
 * confidence / reduce-only toggles across several markets at once. After EVERY command the venue's
 * laws must hold: value is conserved (deposits − withdrawals == cash + uPnL), no non-insurance
 * account goes negative, and every book stays well-formed. Finally, replaying the whole command log
 * must reproduce the exact state (determinism). No random sequence may break solvency.
 */
import { describe, expect, it } from "vitest";
import { INSURANCE_ACCOUNT, replay } from "../src/core.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import { checkConservation, createEngine, marketState, MARKET_IDS, stateRoot } from "../src/state.js";
import { checkBookInvariants } from "../src/book.js";
import type { Command, MarketId, Side } from "../src/types.js";
import { ALICE, BOB, CAROL, DAVE, deposit, lcg, nextNonce, resetIds, run } from "./helpers.js";

const SEEDS = [0xc0ffee, 0x1234, 0xdeadbeef, 0xa11ce, 0xb0b, 0x9a05];

describe("property fuzz: solvency holds under random multi-market adversity", () => {
  it.each(SEEDS)("seed %#: random steps keep conservation, non-negative balances, book invariants + replay-determinism", (seed) => {
    resetIds();
    const INSURANCE_SEED = usd6(1_000_000);
    const s = createEngine(undefined, INSURANCE_SEED);
    const log: Command[] = [];
    const traders = [ALICE, BOB, CAROL, DAVE];
    const markets: MarketId[] = MARKET_IDS.slice(0, 4);
    const base: Record<string, number> = { "SPX-PERP": 5000, "NVDA-PERP": 120, "AAPL-PERP": 220, "MSFT-PERP": 430 };

    const R = lcg(seed);
    const pick = <T>(arr: T[]): T => arr[Math.floor(R() * arr.length)]!;
    let oid = 0;

    // seed balances + initial marks
    for (const t of traders) run(s, log, deposit(t, 100_000));
    for (const m of markets) run(s, log, { kind: "OracleTick", market: m, indexPx: px8(base[m]!), source: "testnet-feed" });

    const markOf = (m: MarketId): number => Number(marketState(s, m).markPx8) / 1e8 || base[m]!;

    const assertInvariants = (label: string): void => {
      const c = checkConservation(s);
      expect(c.holds, `${label}: conservation drift=${c.driftAbs}`).toBe(true);
      for (const [owner, a] of s.accounts) {
        if (owner === INSURANCE_ACCOUNT) continue;
        expect(a.free >= 0n, `${label}: negative free for ${owner}`).toBe(true);
        expect(a.reserved >= 0n, `${label}: negative reserved for ${owner}`).toBe(true);
      }
      for (const m of markets) checkBookInvariants(marketState(s, m).book);
    };

    for (let step = 0; step < 400; step++) {
      const m = pick(markets);
      const mk = markOf(m);
      const roll = R();
      if (roll < 0.45) {
        const owner = pick(traders);
        const side: Side = R() < 0.5 ? "buy" : "sell";
        const price = mk * (1 + (R() - 0.5) * 0.02);
        const qty = 0.1 + R() * 2;
        run(s, log, {
          kind: "PlaceOrder",
          order: {
            id: `fz${oid++}`,
            market: m,
            owner,
            side,
            price: px8(price),
            qty: qty8(qty),
            tif: R() < 0.3 ? "IOC" : "GTC",
            reduceOnly: R() < 0.15,
            nonce: nextNonce(owner),
            expiry: 0,
            signature: "0xtest",
          },
        });
      } else if (roll < 0.75) {
        run(s, log, { kind: "OracleTick", market: m, indexPx: px8(mk * (1 + (R() - 0.5) * 0.06)), source: "testnet-feed" });
      } else if (roll < 0.85) {
        // violent gap in either direction
        run(s, log, { kind: "OracleTick", market: m, indexPx: px8(mk * (R() < 0.5 ? 0.78 : 1.22)), source: "testnet-feed" });
      } else if (roll < 0.92) {
        run(s, log, { kind: "FundingTick", market: m });
      } else {
        run(s, log, {
          kind: "RiskReading",
          reading: {
            kind: "confidence",
            market: m,
            confidence: R(),
            dispersionBps: Math.floor(R() * 100),
            stalenessMs: Math.floor(R() * 8000),
            reduceOnly: R() < 0.5,
            signature: "0xtest",
          },
        });
      }
      assertInvariants(`step ${step} (${m})`);
    }

    // determinism: replaying the identical command log reproduces the exact state root
    const s2 = replay(log, undefined, INSURANCE_SEED);
    expect(stateRoot(s2)).toBe(stateRoot(s));
  }, 30_000);
});
