/**
 * Taker bots — scripted flow archetypes that keep the testnet book breathing.
 * Seeded PRNG (reproducible runs); randomness lives HERE, never in the core.
 */
import { px8 as toPx8, qty8 as toQty8, usd6 } from "../fixed.js";
import type { BotBus } from "./maker.js";

export interface TakerConfig {
  owner: string;
  seed: number;
  maxQty: number; // per order, contracts
  aggressionBps: number; // how far through the touch they'll pay
  tradeEveryMs: number;
  longBias: number; // 0..1
}

export class TakerBot {
  private nonce = 0;
  private seq = 0;
  private x: number;

  constructor(
    private bus: BotBus,
    private cfg: TakerConfig,
  ) {
    this.x = cfg.seed >>> 0;
  }

  private rng(): number {
    this.x = (Math.imul(1103515245, this.x) + 12345) >>> 0;
    return this.x / 4294967296;
  }

  fund(amount: number): void {
    this.bus.dispatch({
      kind: "Deposit",
      owner: this.cfg.owner,
      amount: usd6(amount),
      l1TxHash: "0xbot-funding-testnet-only",
    });
  }

  step(): void {
    const s = this.bus.state;
    if (s.indexPx8 === 0n) return;
    const index = Number(s.indexPx8) / 1e8;
    const side = this.rng() < this.cfg.longBias ? "buy" : "sell";
    const qty = Math.max(0.05, Math.round(this.rng() * this.cfg.maxQty * 100) / 100);
    const px = index * (1 + ((side === "buy" ? 1 : -1) * this.cfg.aggressionBps) / 10_000);

    // occasionally reduce instead of add — keeps positions from drifting to caps
    const acct = s.accounts.get(this.cfg.owner.toLowerCase());
    const reduceOnly = !!acct?.position && acct.position.side !== side && this.rng() < 0.5;

    this.bus.dispatch({
      kind: "PlaceOrder",
      order: {
        id: `tk-${this.cfg.owner.slice(2, 6)}-${this.seq++}`,
        market: "SPX-PERP",
        owner: this.cfg.owner,
        side,
        price: toPx8(Math.round(px * 100) / 100),
        qty: toQty8(qty),
        tif: "IOC",
        reduceOnly,
        nonce: ++this.nonce,
        expiry: 0,
        signature: "0xtaker-bot",
      },
    });
  }
}
