/**
 * EngineBus — wraps the pure engine core and turns its events into Density-shaped
 * wire messages, fanned out per owner. The core stays pure; ALL wire concerns live here.
 */
import { apply } from "../core.js";
import { createEngine, getOrCreateAccount, type EngineState } from "../state.js";
import type { Command, EngineEvent, EngineParams } from "../types.js";
import {
  toAccountUpdate,
  toBookWire,
  toOrderRejected,
  toOrderTradeUpdate,
  toPositionMonitoring,
  type BookWire,
  type OrderMeta,
  type PositionMonitoringWire,
  type WireMessage,
} from "./density.js";

export type OwnerListener = (msg: WireMessage) => void;

export class EngineBus {
  state: EngineState;
  private orderMeta = new Map<string, OrderMeta>();
  private listeners = new Map<string, Set<OwnerListener>>(); // owner -> listeners

  constructor(params?: EngineParams, insuranceSeed6?: bigint) {
    this.state = createEngine(params, insuranceSeed6);
  }

  subscribe(owner: string, fn: OwnerListener): () => void {
    const key = owner.toLowerCase();
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }

  private emitTo(owner: string, msg: WireMessage): void {
    for (const fn of this.listeners.get(owner.toLowerCase()) ?? []) fn(msg);
  }

  /** apply a command and translate the resulting events onto the wire */
  dispatch(cmd: Command): EngineEvent[] {
    const balBefore = new Map<string, bigint>();
    for (const [owner, a] of this.state.accounts) balBefore.set(owner, a.free);

    const events = apply(this.state, cmd);
    const touched = new Set<string>();

    for (const ev of events) {
      switch (ev.kind) {
        case "OrderAccepted": {
          this.orderMeta.set(ev.order.id, {
            owner: ev.order.owner,
            side: ev.order.side,
            tif: ev.order.tif,
            qty: ev.order.qty,
            filled: 0n,
            status: "NEW",
            price: ev.order.price,
          });
          break;
        }
        case "OrderRejected": {
          this.emitTo(ev.owner, toOrderRejected(ev.orderId, ev.owner, ev.reason, this.orderMeta.get(ev.orderId)));
          break;
        }
        case "OrderCanceled": {
          const meta = this.orderMeta.get(ev.orderId);
          if (meta) {
            meta.status = "CANCELED";
            this.emitTo(meta.owner, toOrderTradeUpdate(ev.orderId, meta, null, 0n));
          }
          break;
        }
        case "TradeExecuted": {
          const t = ev.trade;
          for (const [orderId, isTaker] of [
            [t.takerOrderId, true],
            [t.makerOrderId, false],
          ] as const) {
            const meta = this.orderMeta.get(orderId);
            if (!meta) continue; // synthetic liquidation orders carry no meta
            meta.filled += t.qty;
            meta.status = meta.filled >= meta.qty ? "FILLED" : "PARTIALLY_FILLED";
            this.emitTo(meta.owner, toOrderTradeUpdate(orderId, meta, t, 0n));
            touched.add(meta.owner);
            void isTaker;
          }
          touched.add(t.maker);
          touched.add(t.taker);
          break;
        }
        case "PositionLiquidated": {
          // Forward the signed liquidation explainer to the liquidated trader so the
          // UI can show *why* (tier, gap coeff, oracle confidence, equity<MM) with a
          // replayable proof hash — Playbook §2.5. Units converted for the wire.
          const ex = ev.explainer;
          this.emitTo(ex.owner, {
            eventType: "LIQUIDATION_EXPLAINER",
            eventData: {
              owner: ex.owner,
              market: ex.market,
              side: ex.side,
              qty: Number(ex.qty) / 1e8,
              avgFillPx: Number(ex.avgFillPx) / 1e8,
              tier: ex.tierAtLiquidation,
              confidence: ex.confidenceAtLiquidation,
              gapCoefficient: ex.gapCoefficientAtLiquidation,
              equity: Number(ex.equityAtTrigger) / 1e6,
              mmRequired: Number(ex.mmRequiredAtTrigger) / 1e6,
              queueRank: ex.queueRank,
              modelVersion: ex.modelVersions?.tier,
              gapModelVersion: ex.modelVersions?.gap,
              proofHash: ex.inputsHash,
              seq: ex.seq,
            },
          });
          touched.add(ex.owner);
          break;
        }
        case "DepositApplied":
        case "WithdrawApplied": {
          touched.add(ev.owner);
          break;
        }
        default:
          break;
      }
    }

    // one ACCOUNT_UPDATE per touched owner per command — coalesced like Density's stream
    const reason =
      cmd.kind === "Deposit" || cmd.kind === "Withdraw"
        ? "DEPOSIT_WITHDRAW"
        : cmd.kind === "FundingTick"
          ? "FUNDING_FEE"
          : "ORDER";
    for (const owner of touched) {
      const a = this.state.accounts.get(owner.toLowerCase());
      if (!a) continue;
      const change = a.free - (balBefore.get(owner.toLowerCase()) ?? 0n);
      this.emitTo(owner, toAccountUpdate(a, this.state.markPx8, reason, change));
    }

    return events;
  }

  bookSnapshot(limit = 20, decimal = 2): BookWire {
    return toBookWire(this.state.book, { limit, decimal });
  }

  positionMonitoring(owner: string): PositionMonitoringWire[] {
    const a = this.state.accounts.get(owner.toLowerCase());
    if (!a?.position) return [];
    const coeffs = {
      gapCoeff6: this.state.gapCoeff6,
      tierMult6: a.tier ? a.tier.tierMult6 : 1_000_000n,
      tier: a.tier ? a.tier.tier : ("C" as const),
    };
    return [toPositionMonitoring(a.position, this.state.markPx8, this.state.params, coeffs)];
  }

  /** current account state as an ACCOUNT_UPDATE (pushed on connect so the UI paints immediately) */
  accountSnapshot(owner: string): WireMessage {
    const a = getOrCreateAccount(this.state, owner.toLowerCase());
    return toAccountUpdate(a, this.state.markPx8, "SNAPSHOT", 0n);
  }

  /** static params + this trader's live tier — lets the UI render the margin breakdown
   *  (IM = notional × baseIM × gapCoefficient × tierMult) without guessing */
  traderInfo(owner: string) {
    const a = this.state.accounts.get(owner.toLowerCase());
    const tier = a?.tier?.tier ?? "C";
    const tierMult = a?.tier ? Number(a.tier.tierMult6) / 1e6 : 1.0;
    // Explainability: the named behavioral factors that produced this tier, plus the
    // model version — surfaced in the UI so the tier is product-truth, not a badge.
    const factors = a?.tier?.factors ?? [];
    const modelVersion = a?.tier?.modelVersion ?? "tier-v0.1-demo";
    const p = this.state.params;
    return {
      type: "SESSION_INFO",
      market: p.market,
      baseImBps: p.baseImBps,
      baseMmBps: p.baseMmBps,
      mmFloorBps: p.mmFloorBps,
      takerFeeBps: p.takerFeeBps,
      maxLeverage: p.maxLeverageByTier[tier],
      tier,
      tierMult,
      factors,
      modelVersion,
      gapCoefficient: Number(this.state.gapCoeff6) / 1e6,
    };
  }

  /** testnet auth stub: the query token IS the wallet address (documented; real
   *  wallet-signature auth ships with the frontend in M2) */
  resolveToken(token: string): string | null {
    return /^0x[0-9a-fA-F]{40}$/.test(token) ? token.toLowerCase() : null;
  }

  ensureAccount(owner: string): void {
    getOrCreateAccount(this.state, owner.toLowerCase());
  }

  hasBalance(owner: string): boolean {
    const a = this.state.accounts.get(owner.toLowerCase());
    return !!a && (a.free > 0n || a.reserved > 0n || a.position !== null);
  }
}
