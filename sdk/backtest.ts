/**
 * "Backtest against the gap model" — the agent-native tool that quantifies what Perpify's dark-period
 * repricing does to a position BEFORE it's opened. Reuses the venue's real risk functions (the same
 * margin formula the engine enforces and the same gap-coefficient model it publishes), so the numbers
 * an agent sees here are the numbers it will actually face. Pure + deterministic.
 */
import { collateralRequired, imRequired, mmRequired } from "../engine/src/margin.js";
import { toCoeff6, usd6 } from "../engine/src/fixed.js";
import { DEFAULT_PARAMS } from "../engine/src/state.js";
import { computeGapReading, gapScaleFor } from "../engine/src/risk/gapCoefficient.js";
import { TIER_MULT } from "../engine/src/risk/tierScore.js";
import type { TierCode } from "../engine/src/types.js";

const num6 = (v: bigint): number => Number(v) / 1e6;
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

export interface PositionRisk {
  gapCoefficient: number;
  initialMargin: number;
  maintenanceMargin: number;
  requiredCollateral: number;
  maxLeverage: number; // notional / IM at this gap coefficient
  liquidationPrice: number;
  liqMovePct: number; // adverse % move from entry to liquidation (assuming IM posted as collateral)
}

/** Margin + liquidation for a position at one gap coefficient, via the venue's own formula
 *  IM = notional × baseIM × gapCoefficient × tierMult. Liquidation assumes the initial margin is the
 *  posted collateral and MM is taken at entry notional — the standard isolated-margin approximation. */
export function positionRiskAt(p: {
  entryPx: number;
  notionalUsd: number;
  side: "buy" | "sell";
  gapCoefficient: number;
  tier: TierCode;
}): PositionRisk {
  const notional6 = usd6(p.notionalUsd);
  const coeffs = { gapCoeff6: toCoeff6(p.gapCoefficient), tierMult6: toCoeff6(TIER_MULT[p.tier]), tier: p.tier };
  const im = num6(imRequired(notional6, DEFAULT_PARAMS, coeffs));
  const mm = num6(mmRequired(notional6, DEFAULT_PARAMS, coeffs));
  const col = num6(collateralRequired(notional6, DEFAULT_PARAMS, coeffs));
  const qty = p.entryPx > 0 ? p.notionalUsd / p.entryPx : 0;
  const drop = qty > 0 ? (im - mm) / qty : 0; // price move that burns the IM buffer down to MM
  const liq = p.side === "buy" ? p.entryPx - drop : p.entryPx + drop;
  return {
    gapCoefficient: round(p.gapCoefficient, 4),
    initialMargin: round(im),
    maintenanceMargin: round(mm),
    requiredCollateral: round(col),
    maxLeverage: round(im > 0 ? p.notionalUsd / im : 0, 2),
    liquidationPrice: round(Math.max(0, liq)),
    liqMovePct: round(p.entryPx > 0 ? (Math.abs(liq - p.entryPx) / p.entryPx) * 100 : 0),
  };
}

/** A representative Saturday deep in the weekend dark window — where the gap premium is fully priced.
 *  (Fixed reference so the backtest scenarios are deterministic; the live scenario uses the real
 *  current coefficient.) */
const WEEKEND_DARK_MS = Date.parse("2026-03-07T18:00:00Z");

export interface BacktestScenario extends PositionRisk {
  name: string;
}

/** Backtest a position across the gap model: the live coefficient plus the full weekend-dark premium
 *  under each volatility regime. Shows how required margin rises and max leverage falls "through the
 *  cycle" — Perpify prices the dark period into margin before the gap, not after. */
export function backtestGapScenarios(p: {
  market: string;
  entryPx: number;
  notionalUsd: number;
  side: "buy" | "sell";
  tier: TierCode;
  liveGapCoefficient?: number;
}): BacktestScenario[] {
  const scale = gapScaleFor(p.market);
  const out: BacktestScenario[] = [];
  if (typeof p.liveGapCoefficient === "number" && isFinite(p.liveGapCoefficient)) {
    out.push({ name: "live (now)", ...positionRiskAt({ ...p, gapCoefficient: p.liveGapCoefficient }) });
  }
  for (const regime of ["calm", "normal", "elevated", "crisis"] as const) {
    const coeff = computeGapReading(new Date(WEEKEND_DARK_MS), regime, scale).gapCoefficient;
    out.push({ name: `weekend dark · ${regime}`, ...positionRiskAt({ ...p, gapCoefficient: coeff }) });
  }
  return out;
}
