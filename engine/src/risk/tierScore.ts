/**
 * Behavioral tier scoring (tier-v0.2.1).
 *
 * Cold start: a wallet with little/no history gets a *provisional* tier derived
 * deterministically from its address — so two wallets pay different margin immediately (the
 * demo), honestly labelled provisional. As the wallet actually trades, the live model takes
 * over and scores from observed behavior: liquidation history, realized-PnL discipline,
 * turnover vs funding (over-sizing), regime-adjusted sizing, and tenure.
 *
 * Regime-conditioned ("scored through the cycle"): the venue broadcasts a gap coefficient that
 * rises in the overnight/weekend dark period and under stress. The same turnover is a worse
 * risk signal when it was piled on while that premium was elevated, so behavior is scored
 * against the risk the venue itself was pricing at fill time (see BehaviorStats.stressVolumeUsd6,
 * tagged in core.applyFill). Every tier ships with its named contributing factors (explainability
 * is the feature). Pure function of its inputs → replayable when dispatched into the engine as a
 * TierUpdate reading.
 */
import type { BehaviorStats, TierCode } from "../types.js";

export const TIER_MULT: Record<TierCode, number> = { A: 0.75, B: 0.9, C: 1.0, D: 1.2, E: 1.45 };

/**
 * Gap coefficient (1e6-scaled) at/above which the venue is pricing a material overnight/gap
 * premium — the regime we treat as "stressed" for behavioral scoring. 1.15 ≈ a 15%+ dark-period
 * premium, i.e. between a normal and a crisis weekend on the gap-v0.1 curve. Fills that land
 * at/above this (or while the market is reduce-only) are tagged as stress activity in
 * core.applyFill; scoreTier then penalizes over-sizing that concentrated in these windows.
 */
export const STRESS_GAP_COEFF6 = 1_150_000n;

export interface TierResult {
  tier: TierCode;
  tierMult: number;
  factors: { name: string; contribution: number }[];
  modelVersion: string;
}

/**
 * Provisional behavioral tier derived deterministically from the wallet address. Stands in
 * for the behavioral inference engine until real history exists.
 *
 * DEMO POLICY: a fresh wallet has no track record to hold against it, so cold-start skews to
 * the *generous* tiers (A/B, with a little C for spread). A new trader therefore starts with
 * good leverage and a margin discount — never the punitive D/E premium, which is only ever
 * *earned* later by observed behavior (liquidations, over-sizing) via scoreTier() below.
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
  if (bucket < 78)
    return {
      tier: "A",
      tierMult: 0.75,
      factors: [
        { name: "drawdown-discipline", contribution: 0.42 },
        { name: "sizing-vs-balance", contribution: 0.33 },
        { name: "tenure", contribution: 0.25 },
      ],
    };
  if (bucket < 97)
    return {
      tier: "B",
      tierMult: 0.9,
      factors: [
        { name: "consistent-sizing", contribution: 0.55 },
        { name: "low-drawdown-response", contribution: 0.45 },
      ],
    };
  return { tier: "C", tierMult: 1.0, factors: [{ name: "provisional-baseline", contribution: 1.0 }] };
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
    return { tier: provisional.tier, tierMult: provisional.tierMult, factors: provisional.factors, modelVersion: "tier-v0.2.1-provisional" };
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

  // 4) regime-adjusted sizing ("scored through the cycle") — the venue prices a gap premium that
  //    rises in the overnight/weekend dark period and under stress. The SAME turnover is a worse
  //    risk signal when it was piled on while that premium was elevated. Over-sizing INTO the dark
  //    period is the clearest tell of an undisciplined trader; sizing modestly through it earns
  //    trust. Uses stress-tagged volume from core.applyFill (gap coeff ≥ STRESS_GAP_COEFF6 or
  //    reduce-only at fill time).
  const stressTurnover = Number(behavior.stressVolumeUsd6) / 1e6 / funded;
  const stressShare = Number(behavior.volumeUsd6) > 0 ? Number(behavior.stressVolumeUsd6) / Number(behavior.volumeUsd6) : 0;
  if (stressTurnover > 8) {
    score -= 1.5;
    factors.push({ name: "oversizing-into-stress", contribution: -0.35 });
  } else if (behavior.stressTrades >= 3 && stressShare < 0.25) {
    score += 0.75;
    factors.push({ name: "disciplined-through-stress", contribution: 0.2 });
  }

  // 5) tenure — established behavior earns trust
  if (nowSeq - behavior.firstSeenSeq > 2000) {
    score += 0.5;
    factors.push({ name: "tenure", contribution: 0.15 });
  }

  const tier: TierCode = score >= 3 ? "A" : score >= 1.5 ? "B" : score >= 0 ? "C" : score >= -1.5 ? "D" : "E";
  return { tier, tierMult: TIER_MULT[tier], factors: normalize(factors), modelVersion: "tier-v0.2.1-live" };
}
