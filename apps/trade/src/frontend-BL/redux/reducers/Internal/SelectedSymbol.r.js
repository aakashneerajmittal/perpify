import { SET_SELECTED_SYMBOL_SUCCESS } from "../../../redux/constants/Constants";

const initialState = {
  selectedSymbol: ""
};

export default function (state = initialState, action) {
  const { type, payload } = action;
  switch (type) {
    case SET_SELECTED_SYMBOL_SUCCESS:
      // Normalize to the canonical UPPERCASE market id (e.g. "NVDA-PERP"). The market picker
      // drawer can hand us a lowercased symbol; every consumer (engine market-data/order-book
      // subscriptions, chart, gap coefficient, order routing) keys off this value, and the
      // engine matches market ids exactly — so a single normalization here keeps them aligned.
      return {
        ...state,
        selectedSymbol: payload.selectedSymbol ? String(payload.selectedSymbol).toUpperCase() : payload.selectedSymbol
      };
    default:
      return state;
  }
}
