/**
 * The deterministic engine core: apply(state, command) → events.
 *
 * Everything here is driven exclusively by the sequenced command log. Replaying the
 * same log always produces the same state root and the same event hash chain.
 *
 * Collateral model (isolated margin, V1):
 *  - Placing an exposure-increasing order RESERVES collateral (+ taker-fee buffer)
 *    from `free` at limit-price basis. Conservative rule: any order that can rest
 *    (GTC/POST_ONLY) reserves for its FULL qty; only IOC orders get the fast
 *    reduce-path with zero reserve. reduce-only orders must be IOC in v0.
 *  - Fills consume the reservation proportionally: collateral → position, fee → pool.
 *    Reservation not needed after a reduce (or after better-priced fills) returns to free.
 *  - Cancels release the remaining reservation.
 *
 * Liquidation (normal mode, M1):
 *  - Triggered by oracle/funding ticks when equity < MM. Resting orders pulled first,
 *    then a synthetic IOC reduce order crosses the book. Any unfilled remainder is
 *    assumed by the insurance fund AS A POSITION (the fund becomes the counterparty at
 *    mark) — open interest stays balanced, which keeps the conservation law exact.
 *  - Penalty (liqPenaltyBps) goes to the insurance fund. Deficits beyond the position's
 *    collateral become BadDebt covered by the fund.
 *  - Sequenced clearing (reopen mode) consumes a LiquidationPlan instead — M2/M3.
 */

import { addOrder, cancelOrder, ordersOf } from "./book.js";
import { applyBps, bigabs, bigmax, bigmin, notionalUsd6, toCoeff6 } from "./fixed.js";
import {
  collateralRequired,
  imRequired,
  mmRequired,
  positionEquity,
  positionNotional,
  type RiskCoeffs,
} from "./margin.js";
import {
  INSURANCE_ACCOUNT,
  canonicalJson,
  chainEvent,
  createEngine,
  getOrCreateAccount,
  sha256Hex,
  stateRoot,
  type EngineState,
} from "./state.js";
import type { Account, Address, Command, EngineEvent, EngineParams, Order, Side, Trade } from "./types.js";

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

function coeffsFor(s: EngineState, a: Account): RiskCoeffs {
  return {
    gapCoeff6: s.gapCoeff6,
    tierMult6: a.tier ? a.tier.tierMult6 : 1_000_000n,
    tier: a.tier ? a.tier.tier : "C",
  };
}

function currentOiUsd6(s: EngineState): bigint {
  let total = 0n;
  const mark = s.markPx8 || s.indexPx8;
  for (const a of s.accounts.values()) {
    if (a.position) total += positionNotional(a.position, mark);
  }
  return total / 2n;
}

/** insurance fund balance = fund account free + reserved + position equity at mark */
export function insuranceFundBalance(s: EngineState): bigint {
  const a = s.accounts.get(INSURANCE_ACCOUNT);
  if (!a) return 0n;
  let v = a.free + a.reserved;
  if (a.position) v += positionEquity(a.position, s.markPx8);
  return v;
}

// ---------- fill settlement ----------

/**
 * Settle one fill for one party. Handles reduce, reduce-then-flip, increase, open.
 * reserveCol/reserveFee: portions of this party's order reservation consumed by the fill
 * (both 0 for IOC reduce fills and liquidation closes).
 */
function applyFill(
  s: EngineState,
  evs: EngineEvent[],
  owner: Address,
  side: Side,
  px: bigint,
  qty: bigint,
  reserveCol: bigint,
  reserveFee: bigint,
): void {
  const a = getOrCreateAccount(s, owner);
  a.reserved -= reserveCol + reserveFee;
  s.feePool6 += reserveFee;

  let remainingQty = qty;
  let colRemaining = reserveCol;

  const pos = a.position;
  if (pos && pos.side !== side) {
    // ---- reduce (possibly the first leg of a flip) ----
    const closeQty = bigmin(remainingQty, pos.qty);
    const colForClose = qty > 0n ? (reserveCol * closeQty) / qty : 0n;
    const dir = pos.side === "buy" ? 1n : -1n;
    const realized = ((px - pos.entryPx) * closeQty * dir) / 10_000_000_000n;
    const share = (pos.isolatedCollateral * closeQty) / pos.qty;
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
      a.position = null;
    }
    remainingQty -= closeQty;
    colRemaining -= colForClose;
  }

  if (remainingQty > 0n) {
    const cur = a.position;
    if (cur && cur.side === side) {
      // ---- increase ----
      const newQty = cur.qty + remainingQty;
      cur.entryPx = (cur.entryPx * cur.qty + px * remainingQty) / newQty;
      cur.qty = newQty;
      cur.isolatedCollateral += colRemaining;
    } else if (!cur) {
      // ---- open (fresh, or second leg of a flip) ----
      a.position = {
        market: s.params.market,
        owner,
        side,
        qty: remainingQty,
        entryPx: px,
        isolatedCollateral: colRemaining,
        openedSeq: s.seq,
      };
    }
  }

  s.markPx8 = px; // last trade is the mark
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

function placeOrder(s: EngineState, evs: EngineEvent[], raw: Omit<Order, "remaining" | "seq">): void {
  const o: Order = { ...raw, owner: raw.owner.toLowerCase(), remaining: raw.qty, seq: s.seq };
  const a = getOrCreateAccount(s, o.owner);
  const reject = (reason: string) =>
    emit(s, evs, { kind: "OrderRejected", orderId: o.id, owner: o.owner, reason, seq: s.seq });

  if (o.market !== s.params.market) return reject("unknown market");
  if (o.qty <= 0n || o.price <= 0n) return reject("invalid qty/price");
  if (o.nonce <= a.lastNonce) return reject("stale nonce");
  if (o.expiry !== 0 && o.expiry < s.seq) return reject("expired");
  if (s.indexPx8 === 0n) return reject("market not open: no oracle price yet");
  if (o.reduceOnly && o.tif !== "IOC") return reject("reduce-only must be IOC in v0");
  if (s.book.byId.has(o.id)) return reject("duplicate order id");

  const pos = a.position;
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

  if (s.reduceOnly && exposureQty > 0n) return reject("venue in reduce-only mode");
  if (o.tif === "IOC" && !o.reduceOnly && oppositeQty > 0n && o.qty > oppositeQty)
    return reject("would flip position: close first");

  if (exposureQty > 0n) {
    const c = coeffsFor(s, a);
    const notional = notionalUsd6(exposureQty, o.price);
    if (currentOiUsd6(s) + notional > s.params.oiCapUsd6) return reject("OI cap reached");
    const reserveCol = collateralRequired(notional, s.params, c);
    const reserveFee = applyBps(notional, s.params.takerFeeBps);
    if (a.free < reserveCol + reserveFee) return reject("insufficient collateral");
    a.free -= reserveCol + reserveFee;
    a.reserved += reserveCol + reserveFee;
    emit(s, evs, {
      kind: "MarginCheck",
      owner: o.owner,
      orderId: o.id,
      imRequired: imRequired(notional, s.params, c),
      collateralReserved: reserveCol,
      inputs: {
        baseImBps: s.params.baseImBps,
        gapCoefficient6: s.gapCoeff6.toString(),
        tierMult6: c.tierMult6.toString(),
        tier: c.tier,
        maxLeverage: s.params.maxLeverageByTier[c.tier],
        gapModelVersion: s.gapModelVersion,
        tierModelVersion: a.tier?.modelVersion ?? "tier-v0.0-default",
      },
      seq: s.seq,
    });
    reservesOf(s).set(o.id, { colLeft: reserveCol, feeLeft: reserveFee, qtyLeft: o.qty });
  }

  a.lastNonce = o.nonce;
  const outcome = addOrder(s.book, o);

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
    applyFill(s, evs, f.maker, o.side === "buy" ? "sell" : "buy", f.price, f.qty, makerDraw.col, makerDraw.fee);
    applyFill(s, evs, o.owner, o.side, f.price, f.qty, takerDraw.col, takerDraw.fee);
    const trade: Trade = {
      id: `${o.id}-f${fillIdx++}`,
      market: s.params.market,
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

function liquidate(s: EngineState, evs: EngineEvent[], owner: Address): void {
  const a = s.accounts.get(owner);
  if (!a || !a.position) return;
  const c = coeffsFor(s, a);
  const pos = a.position;
  const equityAtTrigger = positionEquity(pos, s.markPx8);
  const mmAtTrigger = mmRequired(positionNotional(pos, s.markPx8), s.params, c);
  const liqSide: Side = pos.side === "buy" ? "sell" : "buy";
  const posSide: Side = pos.side;
  const liqQty = pos.qty;
  const markAtTrigger = s.markPx8;

  // 1) pull their resting orders
  for (const ro of ordersOf(s.book, owner)) {
    cancelOrder(s.book, ro.id);
    releaseReserve(s, owner, ro.id);
    emit(s, evs, { kind: "OrderCanceled", orderId: ro.id, owner, reason: "liquidation", seq: s.seq });
  }

  // 2) synthetic IOC reduce order crossing the whole book
  const synthetic: Order = {
    id: `liq-${s.seq}-${owner.slice(2, 10)}`,
    market: s.params.market,
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
  const outcome = addOrder(s.book, synthetic);

  let filledQty = 0n;
  let fillNotionalPxQty = 0n;
  let fillIdx = 0;
  for (const f of outcome.fills) {
    const makerDraw = drawReserve(s, f.makerOrderId, f.qty);
    applyFill(s, evs, f.maker, posSide, f.price, f.qty, makerDraw.col, makerDraw.fee);
    applyFill(s, evs, owner, liqSide, f.price, f.qty, 0n, 0n);
    filledQty += f.qty;
    fillNotionalPxQty += f.price * f.qty;
    emit(s, evs, {
      kind: "TradeExecuted",
      trade: {
        id: `${synthetic.id}-f${fillIdx++}`,
        market: s.params.market,
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
    const insCol = collateralRequired(notionalUsd6(remainder, markAtTrigger), s.params, {
      gapCoeff6: s.gapCoeff6,
      tierMult6: 1_000_000n,
      tier: "C",
    });
    // fund collateralizes its inherited position from its own balance — staged through
    // `reserved` exactly like a normal order reservation so applyFill's accounting balances
    ins.free -= insCol;
    ins.reserved += insCol;
    applyFill(s, evs, owner, liqSide, markAtTrigger, remainder, 0n, 0n);
    applyFill(s, evs, INSURANCE_ACCOUNT, posSide, markAtTrigger, remainder, insCol, 0n);
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
  const penalty = applyBps(notionalUsd6(liqQty, markAtTrigger), s.params.liqPenaltyBps);
  const paid = bigmin(penalty, bigmax(0n, a.free));
  a.free -= paid;
  getOrCreateAccount(s, INSURANCE_ACCOUNT).free += paid;

  const avgFillPx = filledQty > 0n ? fillNotionalPxQty / filledQty : markAtTrigger;
  emit(s, evs, {
    kind: "PositionLiquidated",
    explainer: {
      owner,
      market: s.params.market,
      avgFillPx,
      qty: liqQty,
      side: posSide,
      tierAtLiquidation: c.tier,
      confidenceAtLiquidation: s.confidence,
      gapCoefficientAtLiquidation: Number(s.gapCoeff6) / 1e6,
      equityAtTrigger,
      mmRequiredAtTrigger: mmAtTrigger,
      queueRank: null, // normal-mode; sequenced clearing sets a rank (M3)
      modelVersions: { tier: a.tier?.modelVersion ?? "tier-v0.0-default", gap: s.gapModelVersion },
      inputsHash: sha256Hex(
        canonicalJson({ owner, equityAtTrigger, mmAtTrigger, mark: markAtTrigger, gap: s.gapCoeff6, tier: c.tier }),
      ),
      seq: s.seq,
    },
  });
}

function liquidationScan(s: EngineState, evs: EngineEvent[]): void {
  // cascades allowed in M1 — this is exactly what the sequencer will pace in M3
  for (let round = 0; round < 25; round++) {
    const owners = [...s.accounts.keys()].sort();
    let any = false;
    for (const owner of owners) {
      if (owner === INSURANCE_ACCOUNT) continue; // fund positions are closed by ops policy in v0
      const a = s.accounts.get(owner)!;
      if (!a.position) continue;
      const c = coeffsFor(s, a);
      if (positionEquity(a.position, s.markPx8) < mmRequired(positionNotional(a.position, s.markPx8), s.params, c)) {
        liquidate(s, evs, owner);
        any = true;
      }
    }
    if (!any) break;
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
      const resting = s.book.byId.get(cmd.orderId);
      if (!resting || resting.owner !== owner) {
        emit(s, evs, { kind: "CommandRejected", command: "CancelOrder", owner, reason: "unknown order", seq: s.seq });
        break;
      }
      cancelOrder(s.book, cmd.orderId);
      releaseReserve(s, owner, cmd.orderId);
      emit(s, evs, { kind: "OrderCanceled", orderId: cmd.orderId, owner, reason: "user", seq: s.seq });
      break;
    }

    case "OracleTick": {
      s.indexPx8 = cmd.indexPx;
      if (s.markPx8 === 0n) s.markPx8 = cmd.indexPx;
      // stale-trade guard: mark = last trade only while it stays within 0.5% of index;
      // beyond that the index is the better truth (proper mark = f(index, mid, last) is an M2 item)
      if (bigabs(s.markPx8 - s.indexPx8) * 200n > s.indexPx8) s.markPx8 = s.indexPx8;
      liquidationScan(s, evs);
      break;
    }

    case "RiskReading": {
      if (cmd.reading.kind === "gap") {
        s.gapCoeff6 = toCoeff6(cmd.reading.gapCoefficient);
        s.gapModelVersion = cmd.reading.modelVersion;
      } else {
        s.confidence = cmd.reading.confidence;
        if (cmd.reading.reduceOnly !== s.reduceOnly) {
          s.reduceOnly = cmd.reading.reduceOnly;
          emit(s, evs, {
            kind: "ReduceOnlyChanged",
            market: s.params.market,
            active: s.reduceOnly,
            cause: `oracle confidence ${cmd.reading.confidence}`,
            seq: s.seq,
          });
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
      if (s.indexPx8 === 0n) break;
      const premiumBps = Number(((s.markPx8 - s.indexPx8) * 10_000n) / s.indexPx8);
      const clamp = s.params.fundingClampBps;
      const rateBps = Math.max(-clamp, Math.min(clamp, premiumBps));
      if (rateBps !== 0) {
        for (const owner of [...s.accounts.keys()].sort()) {
          const a = s.accounts.get(owner)!;
          if (!a.position) continue;
          const pay = applyBps(positionNotional(a.position, s.markPx8), Math.abs(rateBps));
          // rate > 0 (mark above index): longs pay shorts; rate < 0: shorts pay longs
          const isPayer = rateBps > 0 ? a.position.side === "buy" : a.position.side === "sell";
          a.position.isolatedCollateral += isPayer ? -pay : pay;
        }
      }
      emit(s, evs, {
        kind: "FundingApplied",
        market: s.params.market,
        rateBps,
        markPx: s.markPx8,
        indexPx: s.indexPx8,
        seq: s.seq,
      });
      liquidationScan(s, evs); // funding can push positions under MM
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
export function replay(commands: Command[], params?: EngineParams, insuranceSeed6?: bigint): EngineState {
  const s = createEngine(params, insuranceSeed6);
  for (const c of commands) apply(s, c);
  return s;
}
