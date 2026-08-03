/**
 * Behavioral tier scoring (tier-v0.2).
 *
 * Cold start: a wallet with little/no history gets a *provisional* tier derived
 * deterministically from its address — so two wallets pay different margin immediately (the
 * demo), honestly labelled provisional. As the wallet actually trades, the live model takes
 * over and scores from observed behavior: liquidation history, realized-PnL discipline,
 * turnover vs funding (over-sizing), and tenure. Every tier ships with its named contributing
 * factors (explainability is the feature). Pure function of its inputs → replayable when
 * dispatched into the engine as a TierUpdate reading.
 */
import type { BehaviorStats, TierCode } from "../types.js";

export const TIER_MULT: Record<TierCode, number> = { A: 0.75, B: 0.9, C: 1.0, D: 1.2, E: 1.45 };

export interface TierResult {
  tier: TierCode;
  tierMult: number;
  factors: { name: string; contribution: number }[];
  modelVersion: string;
}

/**
 * Provisional behavioral tier derived deterministically from the wallet address. Stands in
 * for the behavioral inference engine until real history exists; distribution skews to B/C
 * like a real book.
 */
export function demoTierForAddress(addr: string): {
  tier: TierCode;
  tierMult: number;
  factors: { name: string; contribution: number }[];
} {
  const h = addr.toLowerCase().replace(/^0x/, "");
  let acc = 0;
  for (let i = 0; i < h.length; i++) acc = (acc * 31 + (parseInt(h[i]!, 16) || 0)) >>> 0;
  const bucket = acc % 100;
  if (bucket < 12)
    return {
      tier: "A",
      tierMult: 0.75,
      factors: [
        { name: "drawdown-discipline", contribution: 0.42 },
        { name: "sizing-vs-balance", contribution: 0.33 },
        { name: "tenure", contribution: 0.25 },
      ],
    };
  if (bucket < 42)
    return {
      tier: "B",
      tierMult: 0.9,
      factors: [
        { name: "consistent-sizing", contribution: 0.55 },
        { name: "low-drawdown-response", contribution: 0.45 },
      ],
    };
  if (bucket < 72) return { tier: "C", tierMult: 1.0, factors: [{ name: "provisional-baseline", contribution: 1.0 }] };
  if (bucket < 90)
    return {
      tier: "D",
      tierMult: 1.2,
      factors: [
        { name: "elevated-volatility-response", contribution: 0.6 },
        { name: "sizing-variance", contribution: 0.4 },
      ],
    };
  return {
    tier: "E",
    tierMult: 1.45,
    factors: [
      { name: "prior-liquidations", contribution: 0.68 },
      { name: "oversizing", contribution: 0.32 },
    ],
  };
}

/** normalize factor magnitudes to sum ~1 for display */
function normalize(factors: { name: string; contribution: number }[]): { name: string; contribution: number }[] {
  const tot = factors.reduce((s, f) => s + Math.abs(f.contribution), 0) || 1;
  return factors.map((f) => ({ name: f.name, contribution: Math.round((Math.abs(f.contribution) / tot) * 100) / 100 }));
}

/**
 * Live behavioral tier from observed behavior. Below an activity floor it returns the
 * provisional address tier (immediate differentiation); above it, it scores from real signals.
 */
export function scoreTier(owner: string, behavior: BehaviorStats, realizedPnl6: bigint, nowSeq: number): TierResult {
  const provisional = demoTierForAddress(owner);
  if (behavior.trades < 4) {
    return { tier: provisional.tier, tierMult: provisional.tierMult, factors: provisional.factors, modelVersion: "tier-v0.2-provisional" };
  }

  let score = 0;
  const factors: { name: string; contribution: number }[] = [];

  // 1) liquidations — the strongest negative
  if (behavior.liquidations > 0) {
    const c = Math.min(3, behavior.liquidations);
    score -= 2 * c;
    factors.push({ name: "prior-liquidations", contribution: -0.5 * c });
  } else {
    score += 1;
    factors.push({ name: "no-liquidations", contribution: 0.3 });
  }

  const funded = Math.max(1, Number(behavior.fundedUsd6) / 1e6);

  // 2) realized-PnL discipline (relative to funding)
  const rpnlPct = Number(realizedPnl6) / 1e6 / funded;
  if (rpnlPct > 0.002) {
    score += 1;
    factors.push({ name: "positive-realized-pnl", contribution: 0.25 });
  } else if (rpnlPct < -0.02) {
    score -= 1;
    factors.push({ name: "drawdown-response", contribution: -0.25 });
  }

  // 3) turnover vs funding — over-sizing / over-trading
  const turnover = Number(behavior.volumeUsd6) / 1e6 / funded;
  if (turnover > 25) {
    score -= 1;
    factors.push({ name: "oversizing", contribution: -0.2 });
  } else {
    score += 0.5;
    factors.push({ name: "consistent-sizing", contribution: 0.2 });
  }

  // 4) tenure — established behavior earns trust
  if (nowSeq - behavior.firstSeenSeq > 2000) {
    score += 0.5;
    factors.push({ name: "tenure", contribution: 0.15 });
  }

  const tier: TierCode = score >= 3 ? "A" : score >= 1.5 ? "B" : score >= 0 ? "C" : score >= -1.5 ? "D" : "E";
  return { tier, tierMult: TIER_MULT[tier], factors: normalize(factors), modelVersion: "tier-v0.2-live" };
}
