import { getStrategyOrderDataApi } from "../../../../frontend-api-service/Api";
import { showSnackBar } from "../Internal/GlobalErrorHandler.ac";
// import { showSnackBar } from "@/frontend-BL/redux/actions/Internal/GlobalErrorHandler.ac";
interface Compare {
  type: string;
}
const compare = (a: Compare, b: Compare) => {
  if (a.type > b.type) return -1;
  return 1;
};
export const GET_STRATEGY_ORDER = (symbol: string) => (dispatch: any) => {
  return getStrategyOrderDataApi(symbol)
    .then((res: any) => {
      const orders = res.data.orders;
      const ocoOrders = orders.filter((order: any) => order.length === 2).map((order: any) => order.sort(compare));
      const individualOrders = orders.filter((order: any) => order.length === 1);
      return { ocoOrders, individualOrders, isEmpty: orders.length === 0 };
    })
    .catch((err: any) => {
      dispatch(
        showSnackBar({
          src: "FOLLOW_ANALYST_FAILED",
          message: err.response.data.details,
          type: "failure"
        })
      );
      return { isEmpty: true };
    });
};
