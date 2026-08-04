/**
 * FETCH_ORDER_HISTORY — Perpify testnet.
 *
 * The Perpify engine has no REST order-history endpoint; history arrives over the account
 * WebSocket and is accumulated in the `perpifyHistory` redux slice (snapshot on connect +
 * live appends, so it survives refresh). This thunk reads that slice, applies the tab's
 * filters, maps each engine record to the row shape the Order History table expects, and
 * paginates — returning the same `{ requiredData, total }` the tab already consumes, so the
 * hook and row components are unchanged.
 *
 * Engine record shape: { orderId, symbol, side (BUY|SELL), type (MARKET|LIMIT), price, qty,
 *   status (FILLED|PARTIALLY_FILLED|CANCELED), realizedPnl, fee, reduceOnly, time (ms) }.
 */
import store from "../../store/configureStore";

const isSet = (v, placeholder) => v !== undefined && v !== null && v !== "" && v !== placeholder;

const mapRecord = (r) => {
  const price = Number(r.price) || 0;
  const qty = Number(r.qty) || 0;
  const pnl = Number(r.realizedPnl) || 0;
  const fee = Number(r.fee) || 0;
  return {
    orderId: r.orderId,
    time: r.time,
    updatedTime: r.time,
    symbol: r.symbol,
    type: r.type,
    side: r.side === "BUY" ? "LONG" : "SHORT",
    avgPrice: price,
    reduceOnly: r.reduceOnly ? "YES" : "NO",
    status: r.status,
    executedQtyInUSDT: qty * price,
    executedQty: qty,
    totalPnL: pnl.toFixed(4),
    trades: [],
    showOrderTriggerCondition: undefined,
    stopPrice: "0",
    totalFee: fee.toFixed(4),
    totalFeePercentage: "0.00",
    isForcedOrder: false,
    forcedOrderType: undefined
  };
};

export const FETCH_ORDER_HISTORY =
  (data = {}) =>
  () => {
    const records = store.getState().perpifyHistory?.records || [];
    const { startTime, endTime, symbol, type, side, reduceOnly, status, size = 5, start = 1 } = data;

    const filtered = records.filter((r) => {
      if (isSet(symbol, "Symbol") && (r.symbol || "").toUpperCase() !== String(symbol).toUpperCase()) return false;
      if (isSet(type, "Order Type") && (r.type || "").toUpperCase() !== String(type).toUpperCase()) return false;
      // the tab shows side as LONG/SHORT; engine stores BUY/SELL
      if (isSet(side, "Side")) {
        const wantBuy = /BUY|LONG/i.test(String(side));
        const isBuy = r.side === "BUY";
        if (wantBuy !== isBuy) return false;
      }
      if (isSet(status, "Status") && !String(r.status || "").toLowerCase().includes(String(status).toLowerCase().replace(/\s+/g, "_"))) return false;
      if (isSet(reduceOnly, "Reduce Only")) {
        const wantRO = /yes|true/i.test(String(reduceOnly));
        if (!!r.reduceOnly !== wantRO) return false;
      }
      if (startTime && endTime && (r.time < Number(startTime) || r.time > Number(endTime))) return false;
      return true;
    });

    const total = filtered.length;
    const pageStart = (Math.max(1, Number(start)) - 1) * Number(size);
    const requiredData = filtered.slice(pageStart, pageStart + Number(size)).map(mapRecord);
    return Promise.resolve({ requiredData, total });
  };
