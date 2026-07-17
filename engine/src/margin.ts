/**
 * Isolated margin math. Pure functions, bigint only.
 *
 * IM = notional × baseIM × gapCoefficient × tierMult      (Playbook §2.1/§2.2)
 * MM = max(notional × baseMM × gapCoefficient × tierMult, notional × mmFloor)
 *
 * Every margin decision the engine makes logs the exact inputs used — that log is
 * what makes "the AI moves your margin" product truth instead of a slide.
 */

import { applyBps, applyCoeff, bigmax, notionalUsd6 } from "./fixed.js";
import type { EngineParams, Position, TierCode, Usd6 } from "./types.js";

export interface RiskCoeffs {
  gapCoeff6: bigint; // >= 1e6
  tierMult6: bigint; // ~0.8e6 (tier A) … ~1.3e6 (tier E)
  tier: TierCode;
}

export function imRequired(notional6: Usd6, p: EngineParams, c: RiskCoeffs): Usd6 {
  return applyCoeff(applyCoeff(applyBps(notional6, p.baseImBps), c.gapCoeff6), c.tierMult6);
}

export function mmRequired(notional6: Usd6, p: EngineParams, c: RiskCoeffs): Usd6 {
  const scaled = applyCoeff(applyCoeff(applyBps(notional6, p.baseMmBps), c.gapCoeff6), c.tierMult6);
  return bigmax(scaled, applyBps(notional6, p.mmFloorBps));
}

/** collateral to reserve for a new/increased exposure: max(IM, notional / maxLeverage) */
export function collateralRequired(notional6: Usd6, p: EngineParams, c: RiskCoeffs): Usd6 {
  const im = imRequired(notional6, p, c);
  const maxLev = p.maxLeverageByTier[c.tier];
  const byLev = notional6 / BigInt(maxLev);
  return bigmax(im, byLev);
}

/** signed unrealized PnL at mark, USD 1e6 */
export function unrealizedPnl(pos: Position, markPx8: bigint): bigint {
  const diff = markPx8 - pos.entryPx; // signed
  const raw = (diff * pos.qty) / 10_000_000_000n; // → usd6, signed
  return pos.side === "buy" ? raw : -raw;
}

export function positionNotional(pos: Position, markPx8: bigint): Usd6 {
  return notionalUsd6(pos.qty, markPx8);
}

/** equity of an isolated position at mark */
export function positionEquity(pos: Position, markPx8: bigint): bigint {
  return pos.isolatedCollateral + unrealizedPnl(pos, markPx8);
}

export function isLiquidatable(pos: Position, markPx8: bigint, p: EngineParams, c: RiskCoeffs): boolean {
  return positionEquity(pos, markPx8) < mmRequired(positionNotional(pos, markPx8), p, c);
}
