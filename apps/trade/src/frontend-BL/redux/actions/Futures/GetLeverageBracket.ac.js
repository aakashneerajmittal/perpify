/* eslint-disable no-unused-vars */
import { GET_LEVERAGE_BRACKET_SUCCESS, GET_LEVERAGE_BRACKET_FAIL } from "../../../redux/constants/Constants";
import { getLeverageBracketApi } from "../../../../frontend-api-service/Api/Futures";

// const leverageBrackets = [
//   {
//     symbol: "BTCUSDT",
//     brackets: [
//       {
//         bracket: 1,
//         initialLeverage: 125,
//         notionalCap: 50000,
//         notionalFloor: 0,
//         maintMarginRatio: 0.004,
//         cum: 0
//       },
//       {
//         bracket: 2,
//         initialLeverage: 100,
//         notionalCap: 250000,
//         notionalFloor: 50000,
//         maintMarginRatio: 0.005,
//         cum: 50
//       },
//       {
//         bracket: 3,
//         initialLeverage: 25,
//         notionalCap: 1000000,
//         notionalFloor: 250000,
//         maintMarginRatio: 0.01,
//         cum: 1300
//       },
//       {
//         bracket: 4,
//         initialLeverage: 15,
//         notionalCap: 10000000,
//         notionalFloor: 1000000,
//         maintMarginRatio: 0.025,
//         cum: 16300
//       },
//       {
//         bracket: 5,
//         initialLeverage: 10,
//         notionalCap: 20000000,
//         notionalFloor: 10000000,
//         maintMarginRatio: 0.05,
//         cum: 266300
//       },
//       {
//         bracket: 6,
//         initialLeverage: 5,
//         notionalCap: 50000000,
//         notionalFloor: 20000000,
//         maintMarginRatio: 0.1,
//         cum: 1266300
//       },
//       {
//         bracket: 7,
//         initialLeverage: 4,
//         notionalCap: 100000000,
//         notionalFloor: 50000000,
//         maintMarginRatio: 0.125,
//         cum: 2516300
//       },
//       {
//         bracket: 8,
//         initialLeverage: 3,
//         notionalCap: 200000000,
//         notionalFloor: 100000000,
//         maintMarginRatio: 0.15,
//         cum: 5016300
//       },
//       {
//         bracket: 9,
//         initialLeverage: 2,
//         notionalCap: 300000000,
//         notionalFloor: 200000000,
//         maintMarginRatio: 0.25,
//         cum: 25016300
//       },
//       {
//         bracket: 10,
//         initialLeverage: 1,
//         notionalCap: 500000000,
//         notionalFloor: 300000000,
//         maintMarginRatio: 0.5,
//         cum: 100016300
//       }
//     ]
//   }
// ];
export const getLeverageBracket = (symbol) => (dispatch) => {
  getLeverageBracketApi(symbol).then(
    (result) => {
      result.data.leverageBrackets.forEach((element) => {
        dispatch({
          type: GET_LEVERAGE_BRACKET_SUCCESS,
          payload: element //
        });
      });
    },
    (error) => {
      const message = error.toString();
      dispatch({
        type: GET_LEVERAGE_BRACKET_FAIL,
        payload: message
      });
      return Promise.reject(error);
    }
  );
};
