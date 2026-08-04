/**
 * perpifyHistory — order/trade history accumulated from the account WebSocket. The Perpify
 * engine has no REST history endpoint; instead it paints an ORDER_HISTORY_SNAPSHOT on connect
 * (so history survives a refresh, like positions and open orders) and streams an
 * ORDER_HISTORY_APPEND on every fill/cancel. This slice powers the Order History and PnL
 * History tabs (their FETCH_ORDER_HISTORY / FETCH_TRADES thunks read from here).
 *
 * Each record: { orderId, symbol, side (BUY|SELL), type (MARKET|LIMIT), price, qty, status
 *   (FILLED|PARTIALLY_FILLED|CANCELED), realizedPnl, fee, reduceOnly, time (ms) }, most recent first.
 */
const initialState = { records: [] };
const CAP = 200;

export default function perpifyHistory(state = initialState, action) {
  switch (action?.type) {
    case "PERPIFY_HISTORY_SNAPSHOT":
      return { records: Array.isArray(action.payload) ? action.payload.slice(0, CAP) : [] };
    case "PERPIFY_HISTORY_APPEND":
      if (!action.payload) return state;
      return { records: [action.payload, ...state.records].slice(0, CAP) };
    case "PERPIFY_LOGOUT":
    case "DESTROY_SESSION":
      return initialState;
    default:
      return state;
  }
}
