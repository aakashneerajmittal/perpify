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
export interface SessionInfoState {
  market: string | null;
  tier: "A" | "B" | "C" | "D" | "E" | null;
  tierMult: number;
  maxLeverage: number | null;
  baseImBps: number | null;
  baseMmBps: number | null;
  takerFeeBps: number | null;
  gapCoefficient: number | null;
  factors: TierFactor[];
  modelVersion: string | null;
}

const initial: SessionInfoState = {
  market: null,
  tier: null,
  tierMult: 1,
  maxLeverage: null,
  baseImBps: null,
  baseMmBps: null,
  takerFeeBps: null,
  gapCoefficient: null,
  factors: [],
  modelVersion: null
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
        takerFeeBps: typeof p.takerFeeBps === "number" ? p.takerFeeBps : state.takerFeeBps,
        gapCoefficient: typeof p.gapCoefficient === "number" ? p.gapCoefficient : state.gapCoefficient,
        factors: Array.isArray(p.factors) ? p.factors : state.factors,
        modelVersion: p.modelVersion ?? state.modelVersion
      };
    }
    case "PERPIFY_LOGOUT":
    case "DESTROY_SESSION":
      return initial;
    default:
      return state;
  }
}
