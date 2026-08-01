/**
 * perpifyWsBridge — a tiny module-level handle on the live account WebSocket + the latest
 * mark price, so API-layer helpers (which have no redux dispatch) can place/cancel orders
 * over the same authenticated socket the fills arrive on.
 *
 *   - The Density WS middleware calls setPerpifySocket(socket) when the account stream opens
 *     and setPerpifySocket(null) when it closes.
 *   - usePerpifyMarketData calls setPerpifyMark(px) on every markPriceUpdate.
 *   - createOrder()/cancelOrderApi() (frontend-api-service) call perpifyWsSend()/getPerpifyMark().
 *
 * No redux import here on purpose — keeps the API layer free of circular deps.
 */
let socket = null;
let markPx = 0;

export const setPerpifySocket = (s) => {
  socket = s;
};

export const setPerpifyMark = (p) => {
  const n = Number(p);
  if (Number.isFinite(n) && n > 0) markPx = n;
};

export const getPerpifyMark = () => markPx;

export const perpifyWsSend = (payload) => {
  try {
    if (socket && socket.readyState === 1 /* OPEN */) {
      socket.send(JSON.stringify(payload));
      return true;
    }
  } catch {
    /* socket went away mid-send */
  }
  return false;
};
