interface OrderbookState {
  symbol: string;
  bids: number[][];
  asks: number[][];
  bidsSnapShot: number[][];
  asksSnapShot: number[][];
  loading: boolean;
}

const initialState: OrderbookState = {
  bids: [],
  asks: [],
  loading: false,
  asksSnapShot: [],
  bidsSnapShot: [],
  symbol: ""
};

export default function (state = initialState, action: { type: string; payload: any }) {
  const { type, payload } = action;
  switch (type) {
    /// new orderbook
    case "SET_ORDER_BOOK_LOADING":
      return { ...state, loading: true, asksSnapShot: [], asks: [], bids: [], bidsSnapShot: [], symbol: payload };
    case "SET_ORDER_BOOK_BINANCE":
      return {
        ...state,
        asksSnapShot: payload.asks,
        bidsSnapShot: payload.bids,
        loading: false
      };
    case "SET_ASKS": {
      if (payload.s === state.symbol) {
        return { ...state, asks: payload.a };
      } else {
        return { ...state, asks: [] };
      }
    }

    case "SET_BIDS": {
      if (state.symbol === payload.s) {
        return { ...state, bids: payload.b };
      } else {
        return { ...state, bids: [] };
      }
    }

    default:
      return state;
  }
}
