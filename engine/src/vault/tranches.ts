/**
 * PVault structured liquidity — off-chain tranche engine (vault-v0.1).
 *
 * A faithful TypeScript port of contracts/src/PVaultTranches.sol so the testnet demo runs the
 * SAME waterfall math the audited contract does. Two tranches share one trading book at
 * structurally different risk (Playbook §2.6):
 *
 *   Senior  ("the Shielded") — first-out, 8% floor / 12% target APY, protected by the junior.
 *   Junior  ("the Shield")   — first-loss, leveraged upside, absorbs drawdowns first.
 *
 * Every epoch the house PnL is routed through the waterfall:
 *   profit → senior target accrual, 15% of the residual to a yield reserve, rest to junior
 *            (or, when junior is thin (<15% of TVL), ALL profit routes to junior);
 *   loss   → junior NAV first, then the yield reserve, then senior; if junior is wiped it is
 *            void (new generation) and the vault enters catastrophe mode; if the whole stack
 *            is exhausted the vault is declared insolvent and halts.
 *
 * This module is deliberately ISOLATED from the trading ledger: it has its own `pooled6`
 * counter and its own conservation invariant (pooled == seniorNav + juniorNav + yieldReserve),
 * asserted after every operation. It never touches Account.free, so the engine's trading
 * conservation law is untouched. All math is integer USD6 (bigint) — deterministic, replayable.
 */

export type Tranche = "senior" | "junior";

export interface VaultParams {
  seniorTargetApyBps: bigint; // 12% target (8% floor backed by reserve)
  reserveCutBps: bigint; // 15% of residual profit → reserve
  juniorMinRatioBps: bigint; // junior < 15% of TVL → all profit to junior
  seniorExitFeeBps: bigint; // 1% senior exit fee during catastrophe → junior recap
  recoveryRatioBps: bigint; // junior ≥ 10% of senior → exit catastrophe
  concentrationBps: bigint; // >5% holders face a per-call withdrawal cap
  juniorLockupSec: number; // 48h junior lock-up (refresh-on-deposit, testnet)
}

export const DEFAULT_VAULT_PARAMS: VaultParams = {
  seniorTargetApyBps: 1200n,
  reserveCutBps: 1500n,
  juniorMinRatioBps: 1500n,
  seniorExitFeeBps: 100n,
  recoveryRatioBps: 1000n,
  concentrationBps: 500n,
  juniorLockupSec: 48 * 3600,
};

export interface TranchePosition {
  shares: bigint;
  gen: number;
  unlockAt: number; // junior only
}

export interface VaultState {
  seniorNav6: bigint;
  totalSeniorShares: bigint;
  seniorGen: number;
  juniorNav6: bigint;
  totalJuniorShares: bigint;
  juniorGen: number;
  yieldReserve6: bigint;
  epochId: number;
  catastropheMode: boolean;
  insolvent: boolean;
  pooled6: bigint; // explicit "USDC balance" mirror for the conservation check
  senior: Map<string, TranchePosition>;
  junior: Map<string, TranchePosition>;
  params: VaultParams;
}

export interface EpochResult {
  epochId: number;
  pnl6: bigint;
  seniorAccrual6: bigint;
  juniorDelta6: bigint;
  reserveDelta6: bigint;
  covered6: bigint; // on a loss, how much the stack actually covered
  uncovered6: bigint; // shortfall → insolvency
  juniorWiped: boolean;
  catastropheMode: boolean;
  insolvent: boolean;
}

const bmin = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function createVault(params: VaultParams = DEFAULT_VAULT_PARAMS): VaultState {
  return {
    seniorNav6: 0n,
    totalSeniorShares: 0n,
    seniorGen: 0,
    juniorNav6: 0n,
    totalJuniorShares: 0n,
    juniorGen: 0,
    yieldReserve6: 0n,
    epochId: 0,
    catastropheMode: false,
    insolvent: false,
    pooled6: 0n,
    senior: new Map(),
    junior: new Map(),
    params,
  };
}

export function tvl6(s: VaultState): bigint {
  return s.seniorNav6 + s.juniorNav6;
}

export function juniorRatioBps(s: VaultState): bigint {
  const tvl = tvl6(s);
  if (tvl === 0n) return 0n;
  return (s.juniorNav6 * 10_000n) / tvl;
}

/** NAV per 1e6 shares, as a float — display only. */
export function navPerShare(nav6: bigint, shares: bigint): number {
  if (shares === 0n) return 1;
  return Number(nav6) / Number(shares);
}

function getPos(map: Map<string, TranchePosition>, owner: string): TranchePosition {
  let p = map.get(owner);
  if (!p) {
    p = { shares: 0n, gen: 0, unlockAt: 0 };
    map.set(owner, p);
  }
  return p;
}

/** Mint shares against a tranche's NAV, honoring generation (a wiped tranche voids old shares). */
function mintShares(p: TranchePosition, amount6: bigint, nav6: bigint, totalShares: bigint, gen: number): bigint {
  if (p.gen !== gen) {
    p.shares = 0n;
    p.gen = gen;
  }
  // After a wipe nav can be > 0 with totalShares == 0 (catastrophe exit fees accrued): the
  // first recap depositor mints against that surplus — the recapitalization bonus, intentional.
  const shares = totalShares === 0n || nav6 === 0n ? amount6 : (amount6 * totalShares) / nav6;
  p.shares += shares;
  return shares;
}

export function assertInvariant(s: VaultState): void {
  const sum = s.seniorNav6 + s.juniorNav6 + s.yieldReserve6;
  if (sum !== s.pooled6) {
    throw new Error(`vault conservation violated: pooled=${s.pooled6} != senior+junior+reserve=${sum}`);
  }
  if (s.seniorNav6 < 0n || s.juniorNav6 < 0n || s.yieldReserve6 < 0n) {
    throw new Error(`vault negative NAV: senior=${s.seniorNav6} junior=${s.juniorNav6} reserve=${s.yieldReserve6}`);
  }
}

export function depositSenior(s: VaultState, owner: string, amount6: bigint, _nowSec: number): bigint {
  if (s.insolvent) throw new Error("vault insolvent");
  if (amount6 <= 0n) throw new Error("zero amount");
  const p = getPos(s.senior, owner);
  const shares = mintShares(p, amount6, s.seniorNav6, s.totalSeniorShares, s.seniorGen);
  s.totalSeniorShares += shares;
  s.seniorNav6 += amount6;
  s.pooled6 += amount6;
  assertInvariant(s);
  return shares;
}

export function depositJunior(s: VaultState, owner: string, amount6: bigint, nowSec: number): bigint {
  if (s.insolvent) throw new Error("vault insolvent");
  if (amount6 <= 0n) throw new Error("zero amount");
  const p = getPos(s.junior, owner);
  const shares = mintShares(p, amount6, s.juniorNav6, s.totalJuniorShares, s.juniorGen);
  s.totalJuniorShares += shares;
  s.juniorNav6 += amount6;
  s.pooled6 += amount6;
  p.unlockAt = nowSec + s.params.juniorLockupSec; // testnet: refresh-on-deposit
  assertInvariant(s);
  return shares;
}

/** Returns the USD6 value paid out to the withdrawer (net of any catastrophe exit fee). */
export function withdrawSenior(s: VaultState, owner: string, shares: bigint, _nowSec: number): bigint {
  if (s.insolvent) throw new Error("vault insolvent");
  const p = getPos(s.senior, owner);
  const held = p.gen === s.seniorGen ? p.shares : 0n;
  if (shares <= 0n || held < shares) throw new Error("insufficient senior shares");
  // concentration guard: holders above 5% of the tranche may withdraw at most 25% per call
  if (held * 10_000n > s.totalSeniorShares * s.params.concentrationBps) {
    if (shares * 4n > held) throw new Error("concentration cap: max 25% per call");
  }
  let value = (shares * s.seniorNav6) / s.totalSeniorShares;
  p.shares -= shares;
  s.totalSeniorShares -= shares;
  s.seniorNav6 -= value;

  let fee = 0n;
  if (s.catastropheMode) {
    fee = (value * s.params.seniorExitFeeBps) / 10_000n; // funds junior recapitalization
    s.juniorNav6 += fee;
    value -= fee;
  }
  s.pooled6 -= value; // fee stays in the pool (moved to junior); only `value` leaves
  assertInvariant(s);
  return value;
}

export function withdrawJunior(s: VaultState, owner: string, shares: bigint, nowSec: number): bigint {
  if (s.insolvent) throw new Error("vault insolvent");
  const p = getPos(s.junior, owner);
  const held = p.gen === s.juniorGen ? p.shares : 0n;
  if (shares <= 0n || held < shares) throw new Error("insufficient junior shares");
  if (nowSec < p.unlockAt) throw new Error("junior locked");
  const value = (shares * s.juniorNav6) / s.totalJuniorShares;
  p.shares -= shares;
  s.totalJuniorShares -= shares;
  s.juniorNav6 -= value;
  s.pooled6 -= value;
  assertInvariant(s);
  return value;
}

/**
 * Route an epoch's house PnL through the waterfall. Profit adds to the pool; a loss is covered
 * out of the stack (the covered amount leaves the pool back to the trading vault). Mirrors
 * PVaultTranches.settleEpoch exactly.
 */
export function settleEpoch(s: VaultState, pnl6: bigint): EpochResult {
  if (s.insolvent) throw new Error("vault insolvent");
  s.epochId += 1;
  let seniorAccrual6 = 0n;
  let reserveDelta6 = 0n;
  let juniorDelta6 = 0n;
  let covered6 = 0n;
  let uncovered6 = 0n;
  let juniorWiped = false;

  if (pnl6 >= 0n) {
    const profit = pnl6;
    if (profit > 0n) {
      s.pooled6 += profit; // operator transfers profit in
      if (juniorRatioBps(s) < s.params.juniorMinRatioBps) {
        s.juniorNav6 += profit; // dynamic yield curve: thin junior → all profit to junior
        juniorDelta6 = profit;
      } else {
        const target = (s.seniorNav6 * s.params.seniorTargetApyBps) / 10_000n / 365n; // daily prorate
        seniorAccrual6 = bmin(profit, target);
        const rest = profit - seniorAccrual6;
        reserveDelta6 = (rest * s.params.reserveCutBps) / 10_000n;
        const toJunior = rest - reserveDelta6;
        s.seniorNav6 += seniorAccrual6;
        s.yieldReserve6 += reserveDelta6;
        s.juniorNav6 += toJunior;
        juniorDelta6 = toJunior;
      }
    }
    if (s.catastropheMode && s.seniorNav6 > 0n && s.juniorNav6 * 10_000n >= s.seniorNav6 * s.params.recoveryRatioBps) {
      s.catastropheMode = false;
    }
  } else {
    let loss = -pnl6;
    const fromJunior = bmin(loss, s.juniorNav6);
    s.juniorNav6 -= fromJunior;
    juniorDelta6 = -fromJunior;
    loss -= fromJunior;

    if (loss > 0n) {
      if (s.totalJuniorShares > 0n) {
        s.juniorGen += 1; // void junior shares — a fresh generation for recap
        s.totalJuniorShares = 0n;
        juniorWiped = true;
      }
      if (!s.catastropheMode) s.catastropheMode = true;
      const fromReserve = bmin(loss, s.yieldReserve6);
      s.yieldReserve6 -= fromReserve;
      loss -= fromReserve;
      const fromSenior = bmin(loss, s.seniorNav6);
      s.seniorNav6 -= fromSenior;
      loss -= fromSenior;
    }
    covered6 = -pnl6 - loss;
    s.pooled6 -= covered6; // covered loss leaves the pool back to the trading vault
    if (loss > 0n) {
      s.insolvent = true;
      uncovered6 = loss;
    }
  }

  assertInvariant(s);
  return {
    epochId: s.epochId,
    pnl6,
    seniorAccrual6,
    juniorDelta6,
    reserveDelta6,
    covered6,
    uncovered6,
    juniorWiped,
    catastropheMode: s.catastropheMode,
    insolvent: s.insolvent,
  };
}

/** A compact, JSON-safe snapshot of vault state for broadcasting to the UI. */
export interface VaultSnapshot {
  seniorNav: number;
  juniorNav: number;
  yieldReserve: number;
  tvl: number;
  juniorRatioBps: number;
  seniorShares: number;
  juniorShares: number;
  seniorNavPerShare: number;
  juniorNavPerShare: number;
  seniorTargetApyBps: number;
  epochId: number;
  catastropheMode: boolean;
  insolvent: boolean;
}

export function snapshot(s: VaultState): VaultSnapshot {
  return {
    seniorNav: Number(s.seniorNav6) / 1e6,
    juniorNav: Number(s.juniorNav6) / 1e6,
    yieldReserve: Number(s.yieldReserve6) / 1e6,
    tvl: Number(tvl6(s)) / 1e6,
    juniorRatioBps: Number(juniorRatioBps(s)),
    seniorShares: Number(s.totalSeniorShares) / 1e6,
    juniorShares: Number(s.totalJuniorShares) / 1e6,
    seniorNavPerShare: navPerShare(s.seniorNav6, s.totalSeniorShares),
    juniorNavPerShare: navPerShare(s.juniorNav6, s.totalJuniorShares),
    seniorTargetApyBps: Number(s.params.seniorTargetApyBps),
    epochId: s.epochId,
    catastropheMode: s.catastropheMode,
    insolvent: s.insolvent,
  };
}
