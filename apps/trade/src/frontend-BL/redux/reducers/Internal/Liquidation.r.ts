/**
 * liquidation — the latest signed liquidation explainer pushed by the engine
 * (Playbook §2.5). The LiquidationExplainerModal watches `latest` and opens when a
 * new explainer arrives; `dismissed` clears it.
 */
export interface LiquidationExplainer {
  owner: string;
  market: string;
  side: string;
  qty: number;
  avgFillPx: number;
  tier: string;
  confidence: number;
  gapCoefficient: number;
  equity: number;
  mmRequired: number;
  queueRank: number | null;
  modelVersion: string;
  gapModelVersion: string;
  proofHash: string;
  seq: number;
}

interface LiquidationState {
  latest: LiquidationExplainer | null;
}

const initial: LiquidationState = { latest: null };

export default function liquidation(state: LiquidationState = initial, action: any): LiquidationState {
  switch (action?.type) {
    case "LIQUIDATION_EXPLAINER":
      return { latest: action.payload };
    case "DISMISS_LIQUIDATION_EXPLAINER":
      return { latest: null };
    case "PERPIFY_LOGOUT":
    case "DESTROY_SESSION":
      return initial;
    default:
      return state;
  }
}
