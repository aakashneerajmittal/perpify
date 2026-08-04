/**
 * EngineBus — wraps the pure engine core and turns its events into Density-shaped
 * wire messages, fanned out per owner. The core stays pure; ALL wire concerns live here.
 */
import { apply } from "../core.js";
import { createEngine, getOrCreateAccount, marketState, type EngineState } from "../state.js";
import type { Command, EngineEvent, EngineParams, MarketId } from "../types.js";
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

  constructor(params?: EngineParams[], insuranceSeed6?: bigint) {
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
            market: ev.order.market,
            side: ev.order.side,
            tif: ev.order.tif,
            qty: ev.order.qty,
            filled: 0n,
            status: "NEW",
            price: ev.order.price,
          });
          // PERPIFY: announce a RESTING order so it appears under Open Orders. Density's stream
          // sent this NEW event; our engine previously only stored meta here and emitted nothing,
          // so resting limit orders were invisible to the client. IOC never rests, so skip it
          // (it only ever produces TradeExecuted or OrderRejected).
          if (ev.order.tif !== "IOC") {
            this.emitTo(ev.order.owner, toOrderTradeUpdate(ev.order.id, this.orderMeta.get(ev.order.id)!, null, 0n));
          }
          break;
        }
        case "OrderRejected": {
          this.emitTo(ev.owner, toOrderRejected(ev.orderId, ev.owner, ev.reason, ev.market, this.orderMeta.get(ev.orderId)));
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
        case "TriggerArmed": {
          const t = ev.trigger;
          this.emitTo(t.owner, {
            eventType: "CONDITIONAL_ORDER_UPDATE",
            orderID: t.id,
            eventData: {
              status: "ARMED",
              id: t.id,
              symbol: t.market,
              side: t.side.toUpperCase(),
              triggerPrice: (Number(t.triggerPx) / 1e8).toFixed(2),
              triggerAbove: t.triggerAbove,
              qty: (Number(t.qty) / 1e8).toFixed(8),
              limitPrice: (Number(t.limitPx) / 1e8).toFixed(2),
              reduceOnly: t.reduceOnly,
            },
          });
          break;
        }
        case "TriggerFired": {
          this.emitTo(ev.owner, {
            eventType: "CONDITIONAL_ORDER_UPDATE",
            orderID: ev.triggerId,
            eventData: { status: "FIRED", id: ev.triggerId, symbol: ev.market },
          });
          touched.add(ev.owner);
          break;
        }
        case "TriggerCanceled": {
          this.emitTo(ev.owner, {
            eventType: "CONDITIONAL_ORDER_UPDATE",
            orderID: ev.triggerId,
            eventData: { status: "CANCELED", id: ev.triggerId, reason: ev.reason },
          });
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
    const markOf = (m: MarketId) => marketState(this.state, m).markPx8;
    for (const owner of touched) {
      const a = this.state.accounts.get(owner.toLowerCase());
      if (!a) continue;
      const change = a.free - (balBefore.get(owner.toLowerCase()) ?? 0n);
      this.emitTo(owner, toAccountUpdate(a, markOf, reason, change));
    }

    return events;
  }

  bookSnapshot(market: MarketId, limit = 20, decimal = 2): BookWire {
    return toBookWire(marketState(this.state, market).book, market, { limit, decimal });
  }

  /** live risk row per open position (one per market the trader holds) */
  positionMonitoring(owner: string): PositionMonitoringWire[] {
    const a = this.state.accounts.get(owner.toLowerCase());
    if (!a) return [];
    const out: PositionMonitoringWire[] = [];
    for (const pos of a.positions.values()) {
      const mkt = marketState(this.state, pos.market);
      const coeffs = {
        gapCoeff6: mkt.gapCoeff6,
        tierMult6: a.tier ? a.tier.tierMult6 : 1_000_000n,
        tier: a.tier ? a.tier.tier : ("C" as const),
      };
      out.push(toPositionMonitoring(pos, mkt.markPx8, mkt.params, coeffs));
    }
    return out;
  }

  /** current account state as an ACCOUNT_UPDATE (pushed on connect so the UI paints immediately) */
  accountSnapshot(owner: string): WireMessage {
    const a = getOrCreateAccount(this.state, owner.toLowerCase());
    const markOf = (m: MarketId) => marketState(this.state, m).markPx8;
    return toAccountUpdate(a, markOf, "SNAPSHOT", 0n);
  }

  /** armed conditional (TP/SL/stop) orders for a trader across all markets (painted on connect) */
  openTriggers(owner: string): Array<Record<string, unknown>> {
    const o = owner.toLowerCase();
    const out: Array<Record<string, unknown>> = [];
    for (const [market, mkt] of this.state.markets) {
      for (const t of mkt.triggers.values()) {
        if (t.owner !== o) continue;
        out.push({
          id: t.id,
          symbol: market,
          side: t.side.toUpperCase(),
          triggerPrice: (Number(t.triggerPx) / 1e8).toFixed(2),
          triggerAbove: t.triggerAbove,
          qty: (Number(t.qty) / 1e8).toFixed(8),
          limitPrice: (Number(t.limitPx) / 1e8).toFixed(2),
          reduceOnly: t.reduceOnly,
        });
      }
    }
    return out;
  }

  /** resting (open) limit orders for a trader across all markets, each as an ORDER_TRADE_UPDATE
   *  with status NEW — the exact shape the client already routes into Open Orders. Painted on
   *  connect so open orders survive a page refresh (there is no REST open-orders endpoint). */
  restingOrders(owner: string): WireMessage[] {
    const o = owner.toLowerCase();
    const out: WireMessage[] = [];
    for (const [market, mkt] of this.state.markets) {
      for (const ord of mkt.book.byId.values()) {
        if (ord.owner !== o) continue;
        const filled = ord.qty - ord.remaining;
        out.push(
          toOrderTradeUpdate(
            ord.id,
            { owner: ord.owner, market, side: ord.side, tif: ord.tif, qty: ord.qty, filled, status: "NEW", price: ord.price },
            null,
            0n,
          ),
        );
      }
    }
    return out;
  }

  /** static params + this trader's live tier for one market — lets the UI render the margin
   *  breakdown (IM = notional × baseIM × gapCoefficient × tierMult) without guessing. Tier and
   *  leverage are account-wide; gapCoefficient is the requested market's live value. */
  traderInfo(owner: string, market: MarketId = "SPX-PERP") {
    const a = this.state.accounts.get(owner.toLowerCase());
    const tier = a?.tier?.tier ?? "C";
    const tierMult = a?.tier ? Number(a.tier.tierMult6) / 1e6 : 1.0;
    // Explainability: the named behavioral factors that produced this tier, plus the
    // model version — surfaced in the UI so the tier is product-truth, not a badge.
    const factors = a?.tier?.factors ?? [];
    const modelVersion = a?.tier?.modelVersion ?? "tier-v0.1-demo";
    const mkt = marketState(this.state, market);
    const p = mkt.params;
    return {
      type: "SESSION_INFO",
      market,
      baseImBps: p.baseImBps,
      baseMmBps: p.baseMmBps,
      mmFloorBps: p.mmFloorBps,
      takerFeeBps: p.takerFeeBps,
      maxLeverage: p.maxLeverageByTier[tier],
      tier,
      tierMult,
      factors,
      modelVersion,
      gapCoefficient: Number(mkt.gapCoeff6) / 1e6,
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
    return !!a && (a.free > 0n || a.reserved > 0n || a.positions.size > 0);
  }
}
