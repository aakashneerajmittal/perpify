/**
 * PVault maker bot — the venue's stand-in liquidity until Quantbox.
 *
 * Thesis on the book: quoted spread = baseSpreadBps × gapCoefficient. When the risk
 * service reprices the dark, the book physically widens — visitors SEE the model.
 * Ladder of POST_ONLY levels each side of index, sized flat, inventory-skewed.
 */
import { px8 as toPx8, qty8 as toQty8, usd6 } from "../fixed.js";
import { marketState, type EngineState } from "../state.js";
import type { Command, EngineEvent, MarketId } from "../types.js";

/** minimal surface bots need — satisfied by EngineBus or any persisting wrapper */
export interface BotBus {
  dispatch(cmd: Command): EngineEvent[];
  state: EngineState;
}

export interface MakerConfig {
  owner: string;
  market: MarketId; // which market this maker quotes
  levels: number; // ladder depth per side
  levelQty: number; // contracts per level
  baseSpreadBps: number; // half-spread at coefficient 1.0
  levelStepBps: number; // distance between ladder levels
  inventorySkewBpsPerContract: number;
  requoteMs: number;
}

export const DEFAULT_MAKER: Omit<MakerConfig, "owner" | "market"> = {
  levels: 8, // deeper ladder so demo market orders fill reliably (was 3 × 0.5 = 1.5/side)
  levelQty: 3, // ~24 contracts (~$178k) of depth per side
  baseSpreadBps: 5,
  levelStepBps: 4,
  inventorySkewBpsPerContract: 1,
  requoteMs: 2000,
};

export class MakerBot {
  private nonce = 0;
  private live: string[] = [];
  private seq = 0;

  constructor(
    private bus: BotBus,
    private cfg: MakerConfig,
  ) {}

  fund(amount: number): void {
    this.bus.dispatch({
      kind: "Deposit",
      owner: this.cfg.owner,
      amount: usd6(amount),
      l1TxHash: "0xbot-funding-testnet-only", // engine-side credit, clearly labeled (depositFor lands in M2)
    });
  }

  /** cancel-replace the full ladder against current index + gap coefficient */
  requote(): void {
    const s = this.bus.state;
    const mkt = marketState(s, this.cfg.market);
    if (mkt.indexPx8 === 0n) return;
    const index = Number(mkt.indexPx8) / 1e8;
    const coeff = Number(mkt.gapCoeff6) / 1e6;

    for (const id of this.live) {
      this.bus.dispatch({ kind: "CancelOrder", market: this.cfg.market, orderId: id, owner: this.cfg.owner });
    }
    this.live = [];

    const acct = s.accounts.get(this.cfg.owner.toLowerCase());
    const pos = acct?.positions.get(this.cfg.market);
    const posQty = pos ? Number(pos.qty) / 1e8 : 0;
    const posSide = pos?.side;
    const inventory = posSide === "buy" ? posQty : posSide === "sell" ? -posQty : 0;
    const skewBps = -inventory * this.cfg.inventorySkewBpsPerContract; // long inventory → shade quotes down

    const halfSpreadBps = this.cfg.baseSpreadBps * coeff; // ← the thesis, visibly
    const mid = index * (1 + skewBps / 10_000);
    // price precision: 2 decimals for every market (index and single-stock perps alike)
    const roundPx = (p: number) => Math.round(p * 100) / 100;

    for (let lvl = 0; lvl < this.cfg.levels; lvl++) {
      const offBps = halfSpreadBps + lvl * this.cfg.levelStepBps;
      for (const side of ["buy", "sell"] as const) {
        const px = mid * (1 + ((side === "buy" ? -1 : 1) * offBps) / 10_000);
        const id = `mm-${this.cfg.market}-${this.seq++}`;
        const events = this.bus.dispatch({
          kind: "PlaceOrder",
          order: {
            id,
            market: this.cfg.market,
            owner: this.cfg.owner,
            side,
            price: toPx8(roundPx(px)),
            qty: toQty8(this.cfg.levelQty),
            tif: "POST_ONLY",
            reduceOnly: false,
            nonce: ++this.nonce,
            expiry: 0,
            signature: "0xmaker-bot",
          },
        });
        if (events.some((e) => e.kind === "OrderAccepted")) this.live.push(id);
      }
    }
  }

  /** current quoted half-spread in bps (for logs/tests) */
  quotedHalfSpreadBps(): number {
    return this.cfg.baseSpreadBps * (Number(marketState(this.bus.state, this.cfg.market).gapCoeff6) / 1e6);
  }
}
