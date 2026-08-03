import { describe, expect, it } from "vitest";
import { usd6 } from "../src/fixed.js";
import {
  createVault,
  depositSenior,
  depositJunior,
  withdrawSenior,
  withdrawJunior,
  settleEpoch,
  juniorRatioBps,
  tvl6,
  assertInvariant,
  snapshot,
  DEFAULT_VAULT_PARAMS,
  type VaultState,
} from "../src/vault/tranches.js";

const A = "0xaaaa000000000000000000000000000000000001";
const B = "0xbbbb000000000000000000000000000000000002";
const C = "0xcccc000000000000000000000000000000000003";

function seeded(): VaultState {
  const v = createVault();
  depositSenior(v, A, usd6(600_000), 0);
  depositJunior(v, B, usd6(200_000), 0);
  return v;
}

describe("PVault tranche engine (vault-v0.1)", () => {
  it("deposits mint 1:1 shares at a fresh NAV and track pooled balance", () => {
    const v = seeded();
    expect(v.seniorNav6).toBe(usd6(600_000));
    expect(v.juniorNav6).toBe(usd6(200_000));
    expect(v.pooled6).toBe(usd6(800_000));
    expect(tvl6(v)).toBe(usd6(800_000));
    assertInvariant(v);
  });

  it("profit with a healthy junior: senior gets the daily-prorated target, reserve takes 15% of the rest, junior the remainder", () => {
    const v = seeded(); // junior ratio = 25% > 15% → normal curve
    const r = settleEpoch(v, usd6(10_000));
    const target = (usd6(600_000) * 1200n) / 10_000n / 365n; // ~$19.7
    expect(r.seniorAccrual6).toBe(target);
    const rest = usd6(10_000) - target;
    expect(r.reserveDelta6).toBe((rest * 1500n) / 10_000n);
    expect(r.juniorDelta6).toBe(rest - (rest * 1500n) / 10_000n);
    // pooled grows by exactly the profit
    expect(v.pooled6).toBe(usd6(810_000));
    assertInvariant(v);
  });

  it("profit with a THIN junior routes ALL profit to junior (dynamic yield curve)", () => {
    const v = createVault();
    depositSenior(v, A, usd6(950_000), 0);
    depositJunior(v, B, usd6(50_000), 0); // junior = 5% < 15%
    expect(juniorRatioBps(v)).toBeLessThan(1500n);
    const r = settleEpoch(v, usd6(8_000));
    expect(r.seniorAccrual6).toBe(0n);
    expect(r.reserveDelta6).toBe(0n);
    expect(r.juniorDelta6).toBe(usd6(8_000));
    expect(v.juniorNav6).toBe(usd6(58_000));
    assertInvariant(v);
  });

  it("a loss inside the junior buffer is absorbed entirely by junior; senior is untouched", () => {
    const v = seeded();
    const r = settleEpoch(v, usd6(-120_000));
    expect(v.juniorNav6).toBe(usd6(80_000));
    expect(v.seniorNav6).toBe(usd6(600_000)); // protected
    expect(r.covered6).toBe(usd6(120_000));
    expect(r.juniorWiped).toBe(false);
    expect(v.catastropheMode).toBe(false);
    expect(v.pooled6).toBe(usd6(680_000)); // covered loss left the pool
    assertInvariant(v);
  });

  it("a loss beyond junior wipes it, enters catastrophe, then eats the reserve, then senior", () => {
    const v = seeded();
    // grow a small reserve first via a healthy-junior profit epoch
    const e1 = settleEpoch(v, usd6(10_000));
    const accrual1 = e1.seniorAccrual6; // senior NAV gained this from epoch 1
    const reserveBefore = v.yieldReserve6;
    expect(reserveBefore).toBeGreaterThan(0n);
    const juniorBefore = v.juniorNav6;
    const loss = juniorBefore + reserveBefore + usd6(50_000); // punches through junior + reserve into senior
    const r = settleEpoch(v, -loss);
    expect(r.juniorWiped).toBe(true);
    expect(v.catastropheMode).toBe(true);
    expect(v.juniorNav6).toBe(0n);
    expect(v.yieldReserve6).toBe(0n);
    expect(v.seniorNav6).toBe(usd6(600_000) + accrual1 - usd6(50_000));
    expect(v.totalJuniorShares).toBe(0n);
    expect(v.insolvent).toBe(false);
    assertInvariant(v);
  });

  it("wiped junior shares are void; the recap depositor starts a clean generation", () => {
    const v = seeded();
    settleEpoch(v, -(usd6(200_000) + usd6(10_000))); // wipe junior, dip senior
    expect(v.catastropheMode).toBe(true);
    // B's old junior shares are now worthless
    const held = v.junior.get(B)!;
    expect(held.gen).toBeLessThan(v.juniorGen);
    // C recapitalizes into the fresh generation
    const shares = depositJunior(v, C, usd6(100_000), 100);
    expect(shares).toBe(usd6(100_000)); // fresh 1:1
    expect(v.junior.get(C)!.gen).toBe(v.juniorGen);
    assertInvariant(v);
  });

  it("senior exit during catastrophe pays a 1% fee that recapitalizes junior", () => {
    const v = seeded();
    settleEpoch(v, -(usd6(200_000) + usd6(10_000))); // catastrophe on, junior wiped
    expect(v.catastropheMode).toBe(true);
    const juniorBefore = v.juniorNav6;
    const paid = withdrawSenior(v, A, usd6(100_000), 200); // 100k shares
    // fee = 1% of gross value → junior; withdrawer receives 99%
    const grossPerShare = paid; // net; reconstruct: net = value*0.99
    expect(v.juniorNav6).toBeGreaterThan(juniorBefore); // recap fee landed
    expect(grossPerShare).toBeGreaterThan(0n);
    assertInvariant(v);
  });

  it("catastrophe exits once junior recovers to ≥10% of senior", () => {
    const v = seeded();
    settleEpoch(v, -(usd6(200_000) + usd6(10_000))); // catastrophe
    expect(v.catastropheMode).toBe(true);
    depositJunior(v, C, usd6(80_000), 100); // rebuild junior well above 10% of senior
    settleEpoch(v, usd6(1_000)); // a profit epoch triggers the recovery check
    expect(v.catastropheMode).toBe(false);
    assertInvariant(v);
  });

  it("total stack exhaustion declares insolvency and halts further ops", () => {
    const v = seeded();
    const total = v.seniorNav6 + v.juniorNav6 + usd6(1); // one dollar beyond everything
    const r = settleEpoch(v, -total);
    expect(r.insolvent).toBe(true);
    expect(r.uncovered6).toBe(usd6(1));
    expect(v.insolvent).toBe(true);
    expect(() => depositSenior(v, C, usd6(1_000), 0)).toThrow();
    expect(() => settleEpoch(v, usd6(1_000))).toThrow();
  });

  it("junior lock-up blocks early withdrawal and clears after the window", () => {
    const v = createVault();
    depositSenior(v, A, usd6(100_000), 0);
    const shares = depositJunior(v, B, usd6(50_000), 1_000);
    expect(() => withdrawJunior(v, B, shares, 1_000 + 3600)).toThrow(/locked/);
    const out = withdrawJunior(v, B, shares, 1_000 + DEFAULT_VAULT_PARAMS.juniorLockupSec + 1);
    expect(out).toBe(usd6(50_000));
    assertInvariant(v);
  });

  it("senior concentration guard caps a >5% holder at 25% of position per call", () => {
    const v = createVault();
    depositSenior(v, A, usd6(900_000), 0); // A is ~100% of the tranche
    depositSenior(v, B, usd6(100_000), 0);
    const held = v.senior.get(A)!.shares;
    expect(() => withdrawSenior(v, A, (held * 3n) / 4n, 10)).toThrow(/concentration/);
    // 25% is allowed
    const out = withdrawSenior(v, A, held / 4n, 10);
    expect(out).toBeGreaterThan(0n);
    assertInvariant(v);
  });

  it("share value tracks NAV: after a junior-only profit, junior shares are worth more, senior unchanged", () => {
    const v = seeded();
    const jSharesBefore = v.junior.get(B)!.shares;
    settleEpoch(v, usd6(20_000));
    // B redeems all junior shares (after the lock-up) → original + its slice of the profit
    const out = withdrawJunior(v, B, jSharesBefore, DEFAULT_VAULT_PARAMS.juniorLockupSec + 1);
    expect(out).toBeGreaterThan(usd6(200_000));
    assertInvariant(v);
  });

  it("conservation invariant holds across a long randomized op sequence", () => {
    const v = seeded();
    // deterministic PRNG (no Math.random for replayability)
    let seed = 123456789;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const owners = [A, B, C];
    let now = 0;
    for (let i = 0; i < 400 && !v.insolvent; i++) {
      now += 3600;
      const roll = rnd();
      try {
        if (roll < 0.3) depositSenior(v, owners[i % 3]!, usd6(1_000 + Math.floor(rnd() * 5_000)), now);
        else if (roll < 0.55) depositJunior(v, owners[i % 3]!, usd6(1_000 + Math.floor(rnd() * 5_000)), now);
        else if (roll < 0.7 && v.totalSeniorShares > 0n) {
          const held = v.senior.get(owners[i % 3]!)?.shares ?? 0n;
          if (held > 0n) withdrawSenior(v, owners[i % 3]!, held / 8n + 1n, now + 10 ** 9);
        } else if (roll < 0.82 && v.totalJuniorShares > 0n) {
          const held = v.junior.get(owners[i % 3]!)?.shares ?? 0n;
          if (held > 0n) withdrawJunior(v, owners[i % 3]!, held / 8n + 1n, now + 10 ** 9);
        } else if (roll < 0.94) settleEpoch(v, usd6(Math.floor(rnd() * 8_000)));
        else settleEpoch(v, -usd6(Math.floor(rnd() * 40_000)));
      } catch {
        /* rejected ops (caps, locks, insufficient) are fine — invariant must still hold */
      }
      assertInvariant(v);
    }
    // snapshot never throws and mirrors state
    const s = snapshot(v);
    expect(s.tvl).toBeCloseTo(Number(tvl6(v)) / 1e6, 6);
  });
});
