/**
 * sessionInfo — the venue's per-trader risk state from the engine's SESSION_INFO
 * message (sent on connect). Drives the Behavioral Tier UI:
 *   tier (A–E), tierMult (margin multiplier), maxLeverage (tier-gated),
 *   base margin bps, gap coefficient, and the named explainability factors.
 */
export interface TierFactor {
  name: string;
  contribution: number;
}
/** the last live tier move (behavior repriced margin) — drives the transient "margin moved"
 *  moment. `seq` increments on every change so the toast fires even for a repeated transition. */
export interface TierChange {
  from: string;
  to: string;
  fromMult: number | null;
  toMult: number;
  factors: TierFactor[];
  seq: number;
}
export interface SessionInfoState {
  market: string | null;
  tier: "A" | "B" | "C" | "D" | "E" | null;
  tierMult: number;
  maxLeverage: number | null;
  baseImBps: number | null;
  baseMmBps: number | null;
  mmFloorBps: number | null;
  takerFeeBps: number | null;
  gapCoefficient: number | null;
  factors: TierFactor[];
  modelVersion: string | null;
  lastChange: TierChange | null;
}

const initial: SessionInfoState = {
  market: null,
  tier: null,
  tierMult: 1,
  maxLeverage: null,
  baseImBps: null,
  baseMmBps: null,
  mmFloorBps: null,
  takerFeeBps: null,
  gapCoefficient: null,
  factors: [],
  modelVersion: null,
  lastChange: null
};

export default function sessionInfo(state: SessionInfoState = initial, action: any): SessionInfoState {
  switch (action?.type) {
    case "SESSION_INFO_UPDATE": {
      const p = action.payload || {};
      return {
        ...state,
        market: p.market ?? state.market,
        tier: p.tier ?? state.tier,
        tierMult: typeof p.tierMult === "number" ? p.tierMult : state.tierMult,
        maxLeverage: typeof p.maxLeverage === "number" ? p.maxLeverage : state.maxLeverage,
        baseImBps: typeof p.baseImBps === "number" ? p.baseImBps : state.baseImBps,
        baseMmBps: typeof p.baseMmBps === "number" ? p.baseMmBps : state.baseMmBps,
        mmFloorBps: typeof p.mmFloorBps === "number" ? p.mmFloorBps : state.mmFloorBps,
        takerFeeBps: typeof p.takerFeeBps === "number" ? p.takerFeeBps : state.takerFeeBps,
        gapCoefficient: typeof p.gapCoefficient === "number" ? p.gapCoefficient : state.gapCoefficient,
        factors: Array.isArray(p.factors) ? p.factors : state.factors,
        modelVersion: p.modelVersion ?? state.modelVersion
      };
    }
    case "TIER_CHANGED": {
      const p = action.payload || {};
      if (!p.to) return state;
      const seq = (state.lastChange?.seq ?? 0) + 1;
      return {
        ...state,
        lastChange: {
          from: p.from,
          to: p.to,
          fromMult: typeof p.fromMult === "number" ? p.fromMult : null,
          toMult: typeof p.toMult === "number" ? p.toMult : state.tierMult,
          factors: Array.isArray(p.factors) ? p.factors : [],
          seq
        }
      };
    }
    case "PERPIFY_LOGOUT":
    case "DESTROY_SESSION":
      return initial;
    default:
      return state;
  }
}
