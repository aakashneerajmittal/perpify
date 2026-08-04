/**
 * FETCH_PNL_HISTORY — Perpify testnet.
 *
 * The PnL History tab shows CLOSED positions (entry vs exit, realized PnL). The Perpify engine
 * streams per-fill order history into the `perpifyHistory` slice; this thunk reconstructs
 * closed-position records from that fill stream client-side: walk fills oldest→newest per
 * symbol, track the running position (signed qty + average entry), and whenever a fill reduces
 * the position emit a closed-position record carrying the position's entry, the fill's exit, and
 * the realized PnL the engine attributed to that closing fill. Returns `{ Data, Total }` in the
 * exact shape the PnL tab consumes (Type + DataPnl), so the hook and row are unchanged.
 */
import store from "../../store/configureStore";

const isSet = (v, placeholder) => v !== undefined && v !== null && v !== "" && v !== placeholder;

// derive closed-position PnL records from the per-fill history (chronological within symbol)
const buildClosedPositions = (records) => {
  const chrono = [...records].reverse().filter((r) => r && r.status !== "CANCELED"); // oldest first
  const open = {}; // symbol -> { signedQty, avgEntry, entryTime, entryFee }
  const closed = [];
  for (const r of chrono) {
    const sym = r.symbol;
    const px = Number(r.price) || 0;
    const qty = Number(r.qty) || 0;
    const fee = Number(r.fee) || 0;
    if (!sym || !(qty > 0)) continue;
    const dir = r.side === "BUY" ? 1 : -1;
    const signedFill = dir * qty;
    const cur = open[sym] || { signedQty: 0, avgEntry: px, entryTime: r.time, entryFee: 0 };

    if (cur.signedQty === 0 || Math.sign(cur.signedQty) === dir) {
      // opening or increasing the position → update weighted-average entry
      const absOld = Math.abs(cur.signedQty);
      const avgEntry = absOld + qty > 0 ? (absOld * cur.avgEntry + qty * px) / (absOld + qty) : px;
      open[sym] = {
        signedQty: cur.signedQty + signedFill,
        avgEntry,
        entryTime: cur.signedQty === 0 ? r.time : cur.entryTime,
        entryFee: cur.entryFee + fee
      };
    } else {
      // reducing / closing the position → emit a closed-position record for the closed portion
      const closedQty = Math.min(qty, Math.abs(cur.signedQty));
      const positionSide = cur.signedQty > 0 ? "BUY" : "SELL";
      closed.push({
        Type: "TRADE",
        id: r.orderId + "-" + r.time,
        DataPnl: {
          Symbol: sym,
          Side: positionSide,
          ExecutedQty: closedQty,
          EntryPrice: cur.avgEntry,
          ExitPrice: px,
          EntryTime: cur.entryTime,
          ExitTime: r.time,
          GrossPnl: Number(r.realizedPnl) || 0,
          EntryFee: cur.entryFee,
          ExitFee: fee,
          Fee: cur.entryFee + fee,
          OrderID: r.orderId,
          ExitTradeIds: []
        }
      });
      const remaining = cur.signedQty + signedFill;
      if (remaining === 0) delete open[sym];
      else if (Math.sign(remaining) !== Math.sign(cur.signedQty)) open[sym] = { signedQty: remaining, avgEntry: px, entryTime: r.time, entryFee: fee }; // flipped
      else open[sym] = { ...cur, signedQty: remaining };
    }
  }
  return closed.reverse(); // most recent first
};

export const FETCH_PNL_HISTORY =
  (data = {}) =>
  () => {
    const records = store.getState().perpifyHistory?.records || [];
    const { start = 1, size = 5, symbol, startTime, endTime, side } = data;
    let closed = buildClosedPositions(records);

    closed = closed.filter((c) => {
      const d = c.DataPnl;
      if (isSet(symbol, "Symbol") && (d.Symbol || "").toUpperCase() !== String(symbol).toUpperCase()) return false;
      if (isSet(side, "Entry Side")) {
        const wantBuy = /BUY|LONG/i.test(String(side));
        if (wantBuy !== (d.Side === "BUY")) return false;
      }
      if (startTime && endTime && (d.ExitTime < Number(startTime) || d.ExitTime > Number(endTime))) return false;
      return true;
    });

    const Total = closed.length;
    const pageStart = (Math.max(1, Number(start)) - 1) * Number(size);
    const Data = closed.slice(pageStart, pageStart + Number(size));
    return Promise.resolve({ Data, Total });
  };
