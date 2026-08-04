import { SET_LEVERAGE_SUCCESS, SET_LEVERAGE_POS_RISK } from "../../../redux/constants/Constants";
import { showSnackBar } from "../Internal/GlobalErrorHandler.ac";

/**
 * PERPIFY: leverage is a CLIENT-SIDE preference. The engine enforces the tier-gated cap
 * (SESSION_INFO.maxLeverage) via collateral = max(IM, notional/maxLeverage) and exposes no
 * REST "set leverage" endpoint — so the old setLeverageApi() call never resolved, and its
 * catch dereferenced error.response.data on a network failure (throwing), which is why the
 * Confirm button did nothing. We store the chosen leverage in positionsDirectory.leverage
 * (what the order-form cost/margin calc reads), snackbar, and confirm.
 */
export const changeLeverage = (symbol, leverage, errorCallBack, successCallBack) => (dispatch) => {
  try {
    const lev = Number(leverage) || 1;
    dispatch({
      type: SET_LEVERAGE_POS_RISK,
      payload: { sym: symbol.toUpperCase(), leverage: lev }
    });
    dispatch(
      showSnackBar({
        src: SET_LEVERAGE_SUCCESS,
        message: `Leverage set to ${lev}x for ${symbol.toUpperCase()}`,
        type: "success"
      })
    );
    if (successCallBack) successCallBack();
  } catch (e) {
    if (errorCallBack) errorCallBack((e && e.message) || "Could not set leverage");
  }
  return Promise.resolve();
};
