import { FETCH_ORDER_HISTORY } from "../../URI";
import { Format } from "../../../helpers";
import axiosWithApiServer from "@/frontend-api-service/Utils/axiosHelpers/axiosWithApiServer";
import { getOrderSide, getOrderStatus, getOrderType, getReduceOnly } from "@/helpers/orderHistoryApiParams";

export const fetchOrderHistory = ({ startTime = "", endTime = "", symbol = "", type = "", side = "", reduceOnly = "", status = "", start = "", size = "" }) => {
  symbol = symbol === "Symbol" ? "" : symbol;
  let ForcedOrder = type === "Liquidation" || type === "ADL" ? true : false;
  type = getOrderType(type);
  side = getOrderSide(side);
  reduceOnly = getReduceOnly(reduceOnly);
  status = getOrderStatus(status);

  let url = Format(FETCH_ORDER_HISTORY.url, startTime, endTime, symbol, type, side, reduceOnly, status, size, start);
  if (ForcedOrder) {
    url += `&forcedOrder=true`;
  }
  return axiosWithApiServer({ url, method: FETCH_ORDER_HISTORY.reqType })
    .then((res) => {
      return res.data ?? [];
    })
    .catch((err) => {
      throw new Error(err?.response?.data?.details);
    });
};
