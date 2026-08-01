import { fetchLeverageApi } from "../../../../frontend-api-service/Api";
import { SET_LEVERAGE_POS_RISK } from "../../constants/Constants";

export const getLeverage = (symbol) => (dispatch) => {
  fetchLeverageApi(symbol).then((leverageFromServer) => {
    const LeverageData = leverageFromServer.data.data;
    for (let i = 0; i < LeverageData.length; i++) {
      dispatch({
        type: SET_LEVERAGE_POS_RISK,
        payload: {
          sym: LeverageData[i].symbol.toUpperCase(),
          leverage: LeverageData[i].leverage
        }
      });
    }
  });
};
