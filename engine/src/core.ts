/**
 * The deterministic engine core: apply(state, command) → events.
 *
 * Everything here is driven exclusively by the sequenced command log. Replaying the
 * same log always produces the same state root and the same event hash chain.
 *
 * Multi-market (V2): every command carries the market it acts on. The core selects that
 * market's book / oracle / mark / gap coefficient and the account's position IN THAT
 * market. One account has ONE cross-collateral `free` balance and an isolated position
 * per market. Liquidation, funding and oracle ticks are scoped to a single market — an
 * NVDA tick only re-checks NVDA positions — which keeps each market independent while the
 * balance is shared.
 *
 * Collateral model (isolated margin):
 *  - Placing an exposure-increasing order RESERVES collateral (+ taker-fee buffer) from
 *    `free` at limit-price basis. Conservative rule: any order that can rest (GTC/POST_ONLY)
 *    reserves for its FULL qty; only IOC orders get the fast reduce-path with zero reserve.
 *    reduce-only orders must be IOC in v0.
 *  - Fills consume the reservation proportionally: collateral → position, fee → pool.
 *  - Cancels release the remaining reservation.
 *
 * Liquidation (normal mode):
 *  - Triggered by oracle/funding ticks when a position's equity < MM. Resting orders pulled
 *    first, then a synthetic IOC reduce order crosses that market's book. Any unfilled
 *    remainder is assumed by the insurance fund AS A POSITION (the fund becomes the
 *    counterparty at mark) — open interest stays balanced, keeping the conservation law exact.
 *  - Penalty (liqPenaltyBps) goes to the insurance fund. Deficits beyond the position's
 *    collateral become BadDebt covered by the fund.
 */

import { addOrder, cancelOrder, ordersOf } from "./book.js";
import { applyBps, bigabs, bigmax, bigmin, notionalUsd6, toCoeff6 } from "./fixed.js";
import {
  collateralRequired,
  imRequired,
  mmRequired,
  positionEquity,
  positionNotional,
  unrealizedPnl,
  type RiskCoeffs,
} from "./margin.js";
import {
  INSURANCE_ACCOUNT,
  canonicalJson,
  chainEvent,
  createEngine,
  getOrCreateAccount,
  marketState,
  sha256Hex,
  stateRoot,
  type EngineState,
} from "./state.js";
import { STRESS_GAP_COEFF6 } from "./risk/tierScore.js";
import type { Account, Address, Command, EngineEvent, EngineParams, MarketId, Order, Side, Trade, TriggerOrder } from "./types.js";

export { INSURANCE_ACCOUNT };

interface OrderReserve {
  colLeft: bigint;
  feeLeft: bigint;
  qtyLeft: bigint;
}

const reserves = new WeakMap<EngineState, Map<string, OrderReserve>>();

function reservesOf(s: EngineState): Map<string, OrderReserve> {
  let m = reserves.get(s);
  if (!m) {
    m = new Map();
    reserves.set(s, m);
  }
  return m;
}

function emit(s: EngineState, evs: EngineEvent[], ev: EngineEvent): void {
  chainEvent(s, ev);
  evs.push(ev);
}

function coeffsFor(s: EngineState, market: MarketId, a: Account): RiskCoeffs {
  return {
    gapCoeff6: marketState(s, market).gapCoeff6,
    tierMult6: a.tier ? a.tier.tierMult6 : 1_000_000n,
    tier: a.tier ? a.tier.tier : "C",
  };
}

function currentOiUsd6(s: EngineState, market: MarketId): bigint {
  const mkt = marketState(s, market);
  const mark = mkt.markPx8 || mkt.indexPx8;
  let total = 0n;
  for (const a of s.accounts.values()) {
    const pos = a.positions.get(market);
    if (pos) total += positionNotional(pos, mark);
  }
  return total / 2n;
}

/** insurance fund balance = fund account free + reserved + Σ position equity (every market) */
export function insuranceFundBalance(s: EngineState): bigint {
  const a = s.accounts.get(INSURANCE_ACCOUNT);
  if (!a) return 0n;
  let v = a.free + a.reserved;
  for (const pos of a.positions.values()) v += positionEquity(pos, marketState(s, pos.market).markPx8);
  return v;
}

// ---------- fill settlement ----------

/** Clamp an R-multiple (×1e6) into [-5R, +10R] so a single outlier round-trip can't dominate the
 *  running average the tier reads. */
function clampR6(r6: bigint): bigint {
  const MAX = 10_000_000n;
  const MIN = -5_000_000n;
  return r6 > MAX ? MAX : r6 < MIN ? MIN : r6;
}

/**
 * Settle one fill for one party in one market. Handles reduce, reduce-then-flip, increase,
 * open. reserveCol/reserveFee: portions of this party's order reservation consumed by the
 * fill (both 0 for IOC reduce fills and liquidation closes).
 */
function applyFill(
  s: EngineState,
  evs: EngineEvent[],
  owner: Address,
  market: MarketId,
  side: Side,
  px: bigint,
  qty: bigint,
  reserveCol: bigint,
  reserveFee: bigint,
): void {
  const a = getOrCreateAccount(s, owner);
  a.reserved -= reserveCol + reserveFee;
  s.feePool6 += reserveFee;

  // revenge-sizing is scored against a loss from a PRIOR fill, not a same-fill flip: snapshot the
  // armed loss notional before this fill's own close leg (below) can overwrite it.
  const armedLoss6 = owner !== INSURANCE_ACCOUNT ? a.behavior.lastLossNotional6 : 0n;
  let lossThisFill = false;

  // behavior tracking for live tiers (skip the insurance fund's backstop fills)
  if (owner !== INSURANCE_ACCOUNT) {
    a.behavior.trades += 1;
    const notional = notionalUsd6(qty, px);
    a.behavior.volumeUsd6 += notional;
    // Regime tag: was the venue pricing elevated overnight/gap risk — or defensive in
    // reduce-only — at the moment this filled? Scoring behavior against the risk the venue
    // itself was broadcasting is the "scored through the cycle" signal (behavioral spec §6-7).
    // Replay-safe: gap/confidence readings are sequenced in the same command log as fills, so
    // the regime at each fill is reconstructed deterministically on replay-on-boot.
    const mkt = marketState(s, market);
    if (mkt.gapCoeff6 >= STRESS_GAP_COEFF6 || mkt.reduceOnly) {
      a.behavior.stressTrades += 1;
      a.behavior.stressVolumeUsd6 += notional;
    }
  }

  let remainingQty = qty;
  let colRemaining = reserveCol;

  const pos = a.positions.get(market);
  if (pos && pos.side !== side) {
    // ---- reduce (possibly the first leg of a flip) ----
    const closeQty = bigmin(remainingQty, pos.qty);
    const colForClose = qty > 0n ? (reserveCol * closeQty) / qty : 0n;
    const dir = pos.side === "buy" ? 1n : -1n;
    const realized = ((px - pos.entryPx) * closeQty * dir) / 10_000_000_000n;
    a.realizedPnl6 += realized; // lifetime realized PnL counter (not cash — cash moves below)
    const share = (pos.isolatedCollateral * closeQty) / pos.qty;
    // Round-trip behavioral capture (spec §5,§7): this reducing leg closes a round-trip — record
    // hold time, R-multiple (realized / margin-at-risk) and the position's MAE, and classify
    // win/loss. A loss arms the revenge check for the next entry. Reads pos.* before the mutations.
    if (owner !== INSURANCE_ACCOUNT) {
      const b = a.behavior;
      b.roundTrips += 1;
      const holdSeq = Math.max(0, s.seq - pos.openedSeq);
      const marginAtRisk = share > 0n ? share : 1n; // collateral released = this leg's 1R risk unit
      b.sumRMultiple6 += clampR6((realized * 1_000_000n) / marginAtRisk);
      if (pos.worstAdverse6 > 0n) b.sumMaeRatio6 += (pos.worstAdverse6 * 1_000_000n) / marginAtRisk;
      if (realized > 0n) {
        b.winners += 1;
        b.sumWinHoldSeq += holdSeq;
      } else if (realized < 0n) {
        b.losers += 1;
        b.sumLossHoldSeq += holdSeq;
        b.lastLossNotional6 = notionalUsd6(closeQty, pos.entryPx); // arm revenge for the next open
        lossThisFill = true;
      }
    }
    pos.isolatedCollateral -= share;
    pos.qty -= closeQty;

    let net = share + realized;
    if (net < 0n) {
      let deficit = -net;
      net = 0n;
      const fromIso = bigmin(deficit, pos.isolatedCollateral); // eat remaining isolated collateral
      pos.isolatedCollateral -= fromIso;
      deficit -= fromIso;
      if (deficit > 0n) {
        const ins = getOrCreateAccount(s, INSURANCE_ACCOUNT);
        ins.free -= deficit; // bad debt — fund covers
        emit(s, evs, { kind: "BadDebt", owner, amount: deficit, coveredByInsurance: ins.free >= 0n, seq: s.seq });
      }
    }
    a.free += net + colForClose; // reservation isn't needed for the reduced part

    if (pos.qty === 0n) {
      a.free += pos.isolatedCollateral;
      a.positions.delete(market);
    }
    remainingQty -= closeQty;
    colRemaining -= colForClose;
  }

  if (remainingQty > 0n) {
    // Tilt / revenge-sizing (spec §6-7): the first entry after a PRIOR losing exit that sizes up
    // sharply (≥1.5× the lost notional). A same-fill flip isn't revenge (lossThisFill guards it),
    // and only this immediate next entry consumes the armed loss — into a stressed regime it's
    // penalized extra.
    if (owner !== INSURANCE_ACCOUNT && armedLoss6 > 0n && !lossThisFill) {
      const entryNotional = notionalUsd6(remainingQty, px);
      if (entryNotional > (armedLoss6 * 3n) / 2n) {
        a.behavior.revengeEvents += 1;
        const rm = marketState(s, market);
        if (rm.gapCoeff6 >= STRESS_GAP_COEFF6 || rm.reduceOnly) a.behavior.revengeStressEvents += 1;
      }
      a.behavior.lastLossNotional6 = 0n; // consumed by this entry (whether or not it fired)
    }
    const cur = a.positions.get(market);
    if (cur && cur.side === side) {
      // ---- increase ----
      const newQty = cur.qty + remainingQty;
      cur.entryPx = (cur.entryPx * cur.qty + px * remainingQty) / newQty;
      cur.qty = newQty;
      cur.isolatedCollateral += colRemaining;
    } else if (!cur) {
      // ---- open (fresh, or second leg of a flip) ----
      a.positions.set(market, {
        market,
        owner,
        side,
        qty: remainingQty,
        entryPx: px,
        isolatedCollateral: colRemaining,
        openedSeq: s.seq,
        worstAdverse6: 0n,
      });
    }
  }

  marketState(s, market).markPx8 = px; // last trade is the mark for this market
}

/** consume proportional reservation for a fill on an order */
function drawReserve(s: EngineState, orderId: string, fillQty: bigint): { col: bigint; fee: bigint } {
  const m = reservesOf(s);
  const r = m.get(orderId);
  if (!r || r.qtyLeft === 0n) return { col: 0n, fee: 0n };
  const q = bigmin(fillQty, r.qtyLeft);
  const col = q === r.qtyLeft ? r.colLeft : (r.colLeft * q) / r.qtyLeft;
  const fee = q === r.qtyLeft ? r.feeLeft : (r.feeLeft * q) / r.qtyLeft;
  r.colLeft -= col;
  r.feeLeft -= fee;
  r.qtyLeft -= q;
  if (r.qtyLeft === 0n) m.delete(orderId);
  return { col, fee };
}

/** release an order's remaining reservation back to free */
function releaseReserve(s: EngineState, owner: Address, orderId: string): void {
  const m = reservesOf(s);
  const r = m.get(orderId);
  if (!r) return;
  const a = getOrCreateAccount(s, owner);
  a.reserved -= r.colLeft + r.feeLeft;
  a.free += r.colLeft + r.feeLeft;
  m.delete(orderId);
}

// ---------- order placement ----------

function placeOrder(s: EngineState, evs: EngineEvent[], raw: Omit<Order, "remaining" | "seq">, internal = false): void {
  const o: Order = { ...raw, owner: raw.owner.toLowerCase(), remaining: raw.qty, seq: s.seq };
  const a = getOrCreateAccount(s, o.owner);
  const reject = (reason: string) =>
    emit(s, evs, { kind: "OrderRejected", orderId: o.id, owner: o.owner, market: o.market, reason, seq: s.seq });

  const mkt = s.markets.get(o.market);
  if (!mkt) return reject("unknown market");
  if (o.qty <= 0n || o.price <= 0n) return reject("invalid qty/price");
  // engine-fired orders (triggers) were validated at arm time and are not user-signed here
  if (!internal && o.nonce <= a.lastNonce) return reject("stale nonce");
  if (!internal && o.expiry !== 0 && o.expiry < s.seq) return reject("expired");
  if (mkt.indexPx8 === 0n) return reject("market not open: no oracle price yet");
  if (o.reduceOnly && o.tif !== "IOC") return reject("reduce-only must be IOC in v0");
  if (mkt.book.byId.has(o.id)) return reject("duplicate order id");

  const pos = a.positions.get(o.market);
  const oppositeQty = pos && pos.side !== o.side ? pos.qty : 0n;

  if (o.reduceOnly) {
    if (oppositeQty === 0n) return reject("reduce-only without opposing position");
    if (o.qty > oppositeQty) {
      o.qty = oppositeQty; // clamp
      o.remaining = oppositeQty;
    }
  }

  // conservative exposure rule: resting-capable orders reserve for FULL qty;
  // IOC orders reserve only for the part beyond the current opposing position
  const exposureQty = o.tif === "IOC" ? bigmax(0n, o.qty - oppositeQty) : o.qty;

  if (mkt.reduceOnly && exposureQty > 0n) return reject("venue in reduce-only mode");
  if (o.tif === "IOC" && !o.reduceOnly && oppositeQty > 0n && o.qty > oppositeQty)
    return reject("would flip position: close first");

  if (exposureQty > 0n) {
    const c = coeffsFor(s, o.market, a);
    const notional = notionalUsd6(exposureQty, o.price);
    if (currentOiUsd6(s, o.market) + notional > mkt.params.oiCapUsd6) return reject("OI cap reached");
    const reserveCol = collateralRequired(notional, mkt.params, c);
    const reserveFee = applyBps(notional, mkt.params.takerFeeBps);
    if (a.free < reserveCol + reserveFee) return reject("insufficient collateral");
    a.free -= reserveCol + reserveFee;
    a.reserved += reserveCol + reserveFee;
    emit(s, evs, {
      kind: "MarginCheck",
      owner: o.owner,
      orderId: o.id,
      imRequired: imRequired(notional, mkt.params, c),
      collateralReserved: reserveCol,
      inputs: {
        baseImBps: mkt.params.baseImBps,
        gapCoefficient6: mkt.gapCoeff6.toString(),
        tierMult6: c.tierMult6.toString(),
        tier: c.tier,
        maxLeverage: mkt.params.maxLeverageByTier[c.tier],
        gapModelVersion: mkt.gapModelVersion,
        tierModelVersion: a.tier?.modelVersion ?? "tier-v0.0-default",
      },
      seq: s.seq,
    });
    reservesOf(s).set(o.id, { colLeft: reserveCol, feeLeft: reserveFee, qtyLeft: o.qty });
  }

  if (!internal) a.lastNonce = o.nonce;
  const outcome = addOrder(mkt.book, o);

  if (outcome.postOnlyRejected) {
    releaseReserve(s, o.owner, o.id);
    return reject("post-only would cross");
  }

  for (const canceled of outcome.stpCanceled) {
    releaseReserve(s, canceled.owner, canceled.id);
    emit(s, evs, {
      kind: "OrderCanceled",
      orderId: canceled.id,
      owner: canceled.owner,
      reason: "self-trade-prevention",
      seq: s.seq,
    });
  }

  emit(s, evs, { kind: "OrderAccepted", order: { ...o } });

  let fillIdx = 0;
  for (const f of outcome.fills) {
    const takerDraw = drawReserve(s, o.id, f.qty);
    const makerDraw = drawReserve(s, f.makerOrderId, f.qty);
    // maker settles first, then taker — a fixed, published rule (any fixed order works,
    // but it must be fixed for determinism)
    applyFill(s, evs, f.maker, o.market, o.side === "buy" ? "sell" : "buy", f.price, f.qty, makerDraw.col, makerDraw.fee);
    applyFill(s, evs, o.owner, o.market, o.side, f.price, f.qty, takerDraw.col, takerDraw.fee);
    const trade: Trade = {
      id: `${o.id}-f${fillIdx++}`,
      market: o.market,
      price: f.price,
      qty: f.qty,
      makerOrderId: f.makerOrderId,
      takerOrderId: o.id,
      maker: f.maker,
      taker: o.owner,
      takerSide: o.side,
      seq: s.seq,
    };
    emit(s, evs, { kind: "TradeExecuted", trade });
  }

  if (!outcome.rested) {
    releaseReserve(s, o.owner, o.id); // fully filled or IOC remainder dropped → release surplus
  }
}

// ---------- liquidation ----------

function liquidate(s: EngineState, evs: EngineEvent[], owner: Address, market: MarketId): void {
  const a = s.accounts.get(owner);
  const pos = a?.positions.get(market);
  if (!a || !pos) return;
  a.behavior.liquidations += 1; // behavioral signal for live tiers
  // a liquidation is the sharpest loss — arm the revenge-sizing check against the trader's next entry.
  if (owner !== INSURANCE_ACCOUNT) a.behavior.lastLossNotional6 = notionalUsd6(pos.qty, pos.entryPx);
  const mkt = marketState(s, market);
  const c = coeffsFor(s, market, a);
  const equityAtTrigger = positionEquity(pos, mkt.markPx8);
  const mmAtTrigger = mmRequired(positionNotional(pos, mkt.markPx8), mkt.params, c);
  const liqSide: Side = pos.side === "buy" ? "sell" : "buy";
  const posSide: Side = pos.side;
  const liqQty = pos.qty;
  const markAtTrigger = mkt.markPx8;

  // 1) pull their resting orders in this market
  for (const ro of ordersOf(mkt.book, owner)) {
    cancelOrder(mkt.book, ro.id);
    releaseReserve(s, owner, ro.id);
    emit(s, evs, { kind: "OrderCanceled", orderId: ro.id, owner, reason: "liquidation", seq: s.seq });
  }

  // 2) synthetic IOC reduce order crossing the whole book
  const synthetic: Order = {
    id: `liq-${s.seq}-${market}-${owner.slice(2, 10)}`,
    market,
    owner,
    side: liqSide,
    price: liqSide === "sell" ? 1n : 10n ** 15n,
    qty: liqQty,
    remaining: liqQty,
    tif: "IOC",
    reduceOnly: true,
    nonce: a.lastNonce, // internal engine order, not user-signed
    expiry: 0,
    signature: "0xengine-liquidation",
    seq: s.seq,
  };
  const outcome = addOrder(mkt.book, synthetic);

  let filledQty = 0n;
  let fillNotionalPxQty = 0n;
  let fillIdx = 0;
  for (const f of outcome.fills) {
    const makerDraw = drawReserve(s, f.makerOrderId, f.qty);
    applyFill(s, evs, f.maker, market, posSide, f.price, f.qty, makerDraw.col, makerDraw.fee);
    applyFill(s, evs, owner, market, liqSide, f.price, f.qty, 0n, 0n);
    filledQty += f.qty;
    fillNotionalPxQty += f.price * f.qty;
    emit(s, evs, {
      kind: "TradeExecuted",
      trade: {
        id: `${synthetic.id}-f${fillIdx++}`,
        market,
        price: f.price,
        qty: f.qty,
        makerOrderId: f.makerOrderId,
        takerOrderId: synthetic.id,
        maker: f.maker,
        taker: owner,
        takerSide: liqSide,
        seq: s.seq,
      },
    });
  }

  // 3) unfilled remainder → insurance fund becomes the counterparty at trigger mark
  const remainder = liqQty - filledQty;
  if (remainder > 0n) {
    const ins = getOrCreateAccount(s, INSURANCE_ACCOUNT);
    const insCol = collateralRequired(notionalUsd6(remainder, markAtTrigger), mkt.params, {
      gapCoeff6: mkt.gapCoeff6,
      tierMult6: 1_000_000n,
      tier: "C",
    });
    // fund collateralizes its inherited position from its own balance — staged through
    // `reserved` exactly like a normal order reservation so applyFill's accounting balances
    ins.free -= insCol;
    ins.reserved += insCol;
    applyFill(s, evs, owner, market, liqSide, markAtTrigger, remainder, 0n, 0n);
    applyFill(s, evs, INSURANCE_ACCOUNT, market, posSide, markAtTrigger, remainder, insCol, 0n);
    emit(s, evs, {
      kind: "BackstopFill",
      owner,
      qty: remainder,
      px: markAtTrigger,
      note: "insurance-fund-counterparty",
      seq: s.seq,
    });
  }

  // 4) liquidation penalty from the owner's post-close free balance → insurance fund
  const penalty = applyBps(notionalUsd6(liqQty, markAtTrigger), mkt.params.liqPenaltyBps);
  const paid = bigmin(penalty, bigmax(0n, a.free));
  a.free -= paid;
  getOrCreateAccount(s, INSURANCE_ACCOUNT).free += paid;

  const avgFillPx = filledQty > 0n ? fillNotionalPxQty / filledQty : markAtTrigger;
  emit(s, evs, {
    kind: "PositionLiquidated",
    explainer: {
      owner,
      market,
      avgFillPx,
      qty: liqQty,
      side: posSide,
      tierAtLiquidation: c.tier,
      confidenceAtLiquidation: mkt.confidence,
      gapCoefficientAtLiquidation: Number(mkt.gapCoeff6) / 1e6,
      equityAtTrigger,
      mmRequiredAtTrigger: mmAtTrigger,
      queueRank: null, // normal-mode; sequenced clearing sets a rank (M3)
      modelVersions: { tier: a.tier?.modelVersion ?? "tier-v0.0-default", gap: mkt.gapModelVersion },
      inputsHash: sha256Hex(
        canonicalJson({ owner, market, equityAtTrigger, mmAtTrigger, mark: markAtTrigger, gap: mkt.gapCoeff6, tier: c.tier }),
      ),
      seq: s.seq,
    },
  });
}

/** Update each open position's worst adverse excursion (MAE) at the current mark — the running peak
 *  unrealized loss, read by the tier's risk-management signal at close. Replay-safe: driven by the
 *  same sequenced oracle ticks as everything else. */
function trackExcursions(s: EngineState, market: MarketId): void {
  const mark = marketState(s, market).markPx8;
  if (mark === 0n) return;
  for (const [owner, a] of s.accounts) {
    if (owner === INSURANCE_ACCOUNT) continue;
    const pos = a.positions.get(market);
    if (!pos) continue;
    const up = unrealizedPnl(pos, mark);
    if (up < 0n && -up > pos.worstAdverse6) pos.worstAdverse6 = -up;
  }
}

/** scan one market for under-margin positions and liquidate them (cascades allowed) */
function liquidationScan(s: EngineState, evs: EngineEvent[], market: MarketId): void {
  const mkt = marketState(s, market);
  for (let round = 0; round < 25; round++) {
    const owners = [...s.accounts.keys()].sort();
    let any = false;
    for (const owner of owners) {
      if (owner === INSURANCE_ACCOUNT) continue; // fund positions are closed by ops policy in v0
      const a = s.accounts.get(owner)!;
      const pos = a.positions.get(market);
      if (!pos) continue;
      const c = coeffsFor(s, market, a);
      if (positionEquity(pos, mkt.markPx8) < mmRequired(positionNotional(pos, mkt.markPx8), mkt.params, c)) {
        liquidate(s, evs, owner, market);
        any = true;
      }
    }
    if (!any) break;
  }
}

// ---------- conditional (trigger) orders ----------

/**
 * Fire any armed trigger whose price has been crossed by the current mark, in deterministic
 * id order. A reduce-only trigger (TP/SL on a position) always fires as a marketable IOC that
 * crosses the book; a stop-entry may fire as a resting GTC limit. Firing can move the mark and
 * arm further triggers, so we loop (bounded) until nothing new crosses.
 */
function fireTriggers(s: EngineState, evs: EngineEvent[], market: MarketId): void {
  const mkt = marketState(s, market);
  for (let round = 0; round < 10; round++) {
    const mark = mkt.markPx8;
    if (mark === 0n) return;
    let fired = false;
    for (const id of [...mkt.triggers.keys()].sort()) {
      const t = mkt.triggers.get(id);
      if (!t) continue;
      const crossed = t.triggerAbove ? mark >= t.triggerPx : mark <= t.triggerPx;
      if (!crossed) continue;
      mkt.triggers.delete(id);
      emit(s, evs, { kind: "TriggerFired", triggerId: id, owner: t.owner, market, seq: s.seq });
      const asMarket = t.limitPx === 0n || t.reduceOnly; // reduce-only brackets always market-close
      const refIdx = mkt.indexPx8 || mark;
      const px = asMarket ? (t.side === "buy" ? (refIdx * 105n) / 100n : (refIdx * 95n) / 100n) : t.limitPx;
      placeOrder(
        s,
        evs,
        {
          id: `trg-${id}`,
          market,
          owner: t.owner,
          side: t.side,
          price: px,
          qty: t.qty,
          tif: asMarket ? "IOC" : "GTC",
          reduceOnly: t.reduceOnly,
          nonce: t.nonce,
          expiry: 0,
          signature: t.signature,
        },
        true,
      );
      fired = true;
    }
    if (!fired) break;
  }
}

// ---------- the apply loop ----------

export function apply(s: EngineState, cmd: Command): EngineEvent[] {
  const evs: EngineEvent[] = [];
  s.seq++;

  switch (cmd.kind) {
    case "Deposit": {
      const owner = cmd.owner.toLowerCase();
      if (cmd.amount <= 0n) {
        emit(s, evs, { kind: "CommandRejected", command: "Deposit", owner, reason: "non-positive amount", seq: s.seq });
        break;
      }
      const a = getOrCreateAccount(s, owner);
      a.free += cmd.amount;
      a.behavior.fundedUsd6 += cmd.amount;
      s.totalDeposited6 += cmd.amount;
      emit(s, evs, { kind: "DepositApplied", owner, amount: cmd.amount, l1TxHash: cmd.l1TxHash, seq: s.seq });
      break;
    }

    case "Withdraw": {
      const owner = cmd.owner.toLowerCase();
      const a = getOrCreateAccount(s, owner);
      if (cmd.amount <= 0n || cmd.amount > a.free) {
        emit(s, evs, { kind: "CommandRejected", command: "Withdraw", owner, reason: "exceeds free collateral", seq: s.seq });
        break;
      }
      a.free -= cmd.amount;
      s.totalWithdrawn6 += cmd.amount;
      emit(s, evs, { kind: "WithdrawApplied", owner, amount: cmd.amount, seq: s.seq });
      break;
    }

    case "PlaceOrder":
      placeOrder(s, evs, cmd.order);
      break;

    case "CancelOrder": {
      const owner = cmd.owner.toLowerCase();
      const mkt = s.markets.get(cmd.market);
      const resting = mkt?.book.byId.get(cmd.orderId);
      if (!mkt || !resting || resting.owner !== owner) {
        emit(s, evs, { kind: "CommandRejected", command: "CancelOrder", owner, reason: "unknown order", seq: s.seq });
        break;
      }
      cancelOrder(mkt.book, cmd.orderId);
      releaseReserve(s, owner, cmd.orderId);
      emit(s, evs, { kind: "OrderCanceled", orderId: cmd.orderId, owner, reason: "user", seq: s.seq });
      break;
    }

    case "OracleTick": {
      const mkt = s.markets.get(cmd.market);
      if (!mkt) break;
      mkt.indexPx8 = cmd.indexPx;
      if (mkt.markPx8 === 0n) mkt.markPx8 = cmd.indexPx;
      // stale-trade guard: mark = last trade only while it stays within 0.5% of index;
      // beyond that the index is the better truth (proper mark = f(index, mid, last) is an M2 item)
      if (bigabs(mkt.markPx8 - mkt.indexPx8) * 200n > mkt.indexPx8) mkt.markPx8 = mkt.indexPx8;
      trackExcursions(s, cmd.market); // update MAE at the fresh mark before triggers/liquidation
      fireTriggers(s, evs, cmd.market); // stops/TPs fire before forced liquidation gets the chance
      liquidationScan(s, evs, cmd.market);
      break;
    }

    case "RiskReading": {
      if (cmd.reading.kind === "gap") {
        const mkt = s.markets.get(cmd.reading.market);
        if (mkt) {
          mkt.gapCoeff6 = toCoeff6(cmd.reading.gapCoefficient);
          mkt.gapModelVersion = cmd.reading.modelVersion;
        }
      } else {
        const mkt = s.markets.get(cmd.reading.market);
        if (mkt) {
          mkt.confidence = cmd.reading.confidence;
          if (cmd.reading.reduceOnly !== mkt.reduceOnly) {
            mkt.reduceOnly = cmd.reading.reduceOnly;
            emit(s, evs, {
              kind: "ReduceOnlyChanged",
              market: cmd.reading.market,
              active: mkt.reduceOnly,
              cause: `oracle confidence ${cmd.reading.confidence}`,
              seq: s.seq,
            });
          }
        }
      }
      break;
    }

    case "TierUpdate": {
      const a = getOrCreateAccount(s, cmd.reading.wallet.toLowerCase());
      a.tier = { ...cmd.reading, wallet: cmd.reading.wallet.toLowerCase(), tierMult6: toCoeff6(cmd.reading.tierMult) };
      break;
    }

    case "FundingTick": {
      const mkt = s.markets.get(cmd.market);
      if (!mkt || mkt.indexPx8 === 0n) break;
      const premiumBps = Number(((mkt.markPx8 - mkt.indexPx8) * 10_000n) / mkt.indexPx8);
      const clamp = mkt.params.fundingClampBps;
      const rateBps = Math.max(-clamp, Math.min(clamp, premiumBps));
      if (rateBps !== 0) {
        for (const owner of [...s.accounts.keys()].sort()) {
          const a = s.accounts.get(owner)!;
          const pos = a.positions.get(cmd.market);
          if (!pos) continue;
          const pay = applyBps(positionNotional(pos, mkt.markPx8), Math.abs(rateBps));
          // rate > 0 (mark above index): longs pay shorts; rate < 0: shorts pay longs
          const isPayer = rateBps > 0 ? pos.side === "buy" : pos.side === "sell";
          pos.isolatedCollateral += isPayer ? -pay : pay;
        }
      }
      emit(s, evs, {
        kind: "FundingApplied",
        market: cmd.market,
        rateBps,
        markPx: mkt.markPx8,
        indexPx: mkt.indexPx8,
        seq: s.seq,
      });
      liquidationScan(s, evs, cmd.market); // funding can push positions under MM
      break;
    }

    case "PlaceTrigger": {
      const t = cmd.trigger;
      const owner = t.owner.toLowerCase();
      const mkt = s.markets.get(t.market);
      if (!mkt) {
        emit(s, evs, { kind: "CommandRejected", command: "PlaceTrigger", owner, reason: "unknown market", seq: s.seq });
        break;
      }
      if (t.qty <= 0n || t.triggerPx <= 0n) {
        emit(s, evs, { kind: "CommandRejected", command: "PlaceTrigger", owner, reason: "invalid trigger", seq: s.seq });
        break;
      }
      if (mkt.triggers.has(t.id)) {
        emit(s, evs, { kind: "CommandRejected", command: "PlaceTrigger", owner, reason: "duplicate trigger id", seq: s.seq });
        break;
      }
      const armed: TriggerOrder = { ...t, owner, seq: s.seq };
      mkt.triggers.set(t.id, armed);
      emit(s, evs, { kind: "TriggerArmed", trigger: armed });
      // if the mark has already crossed the trigger price, fire immediately
      fireTriggers(s, evs, t.market);
      break;
    }

    case "CancelTrigger": {
      const owner = cmd.owner.toLowerCase();
      const mkt = s.markets.get(cmd.market);
      const t = mkt?.triggers.get(cmd.triggerId);
      if (!mkt || !t || t.owner !== owner) {
        emit(s, evs, { kind: "CommandRejected", command: "CancelTrigger", owner, reason: "unknown trigger", seq: s.seq });
        break;
      }
      mkt.triggers.delete(cmd.triggerId);
      emit(s, evs, { kind: "TriggerCanceled", triggerId: cmd.triggerId, owner, reason: "user", seq: s.seq });
      break;
    }

    case "LiquidationPlan": {
      s.pendingPlan = cmd.plan;
      emit(s, evs, {
        kind: "LiquidationPlanAccepted",
        market: cmd.market,
        publishedHash: cmd.plan.publishedHash,
        entries: cmd.plan.entries.length,
        seq: s.seq,
      });
      break;
    }

    case "EpochClose": {
      s.epochId = cmd.epochId;
      emit(s, evs, { kind: "EpochSettled", epochId: cmd.epochId, stateRoot: stateRoot(s), seq: s.seq });
      break;
    }
  }

  return evs;
}

/** replay a full command log from genesis — the fairness artifact and the golden test */
export function replay(commands: Command[], params?: EngineParams[], insuranceSeed6?: bigint): EngineState {
  const s = createEngine(params, insuranceSeed6);
  for (const c of commands) apply(s, c);
  return s;
}
