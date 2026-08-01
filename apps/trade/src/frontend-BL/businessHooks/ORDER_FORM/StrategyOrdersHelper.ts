import { showSnackBar } from "../../redux/actions/Internal/GlobalErrorHandler.ac";
import { placeOCOOrderApi, cancelOrderApi, cancelAllStrategyOrdersApi, deleteStrategyOrderByID } from "../../../frontend-api-service/Api";
import { DENSITY_WS_SUBSCRIBE_CREATE_ORDER } from "../../redux/constants/Constants";
import { GET_STRATEGY_ORDER } from "../../redux/actions/Futures/GetStrategyOrder.ac";
import { recordCleverTapEvent } from "../../../utils/recordCleverTapEvent";
interface Order {
  symbol: any;
  side: any;
  price: any;
  stopPrice: any;
  type: string;
}

const MapOrder: { [key: string]: string } = {
  LIMIT: "Limit",
  MARKET: "Market",
  STOP_MARKET: "Stop Market",
  STOP: "Stop",
  TAKE_PROFIT: "Take Profit",
  TAKE_PROFIT_MARKET: "Take Profit Market"
};
interface StrategyOrders {
  symbol: string;
}
interface Props {
  dispatch: Function;
  strategyOrdersToPlace: StrategyOrders[];
  setLoading: Function;
  setStrategyOrders: Function;
  close: Function;
}

export const placeOCOOrderHelper = ({ dispatch, strategyOrdersToPlace, setLoading, setStrategyOrders, close }: Props) => {
  placeOCOOrderApi({ orders: strategyOrdersToPlace, type: "OCO" })
    .then((response: any) => {
      setLoading(false);
      if (response?.data?.errors && response?.data?.errors?.length > 0) {
        response.data?.errors.map((err: any, index: number) => {
          const orderType = index === 0 ? "TP" : "SL";
          recordCleverTapEvent(`OTOCO_ORDER_FAIL_${orderType}`, {
            errror: err.message
          });
          dispatch(
            showSnackBar({
              src: "ORDER_CREATION_TPSL_FAILED",
              message: err.message,
              type: "failure"
            })
          );
        });
        close();
      }
      if (response?.data?.orders?.length > 0) {
        response.data.orders.map((order: Order, index: number) => {
          dispatch(
            showSnackBar({
              src: "ORDER_CREATION_TPSL_SUCCESS",
              message: `Your ${MapOrder[order?.type]} order has been created successfully`,
              type: "success"
            })
          );
          const orderType = index === 0 ? "TP" : "SL";
          recordCleverTapEvent(`OTOCO_ORDER_SUCCESS_${orderType}`, {
            symbol: order?.symbol,
            side: order?.side,
            type: order?.type,
            price: order?.price,
            stopPrice: order?.stopPrice
          });
        });
        dispatch({
          type: DENSITY_WS_SUBSCRIBE_CREATE_ORDER,
          payload: {
            data: response.data.orders,
            type: "LIMIT",
            eventType: "CREATE_ORDER"
          }
        });
        dispatch(GET_STRATEGY_ORDER(strategyOrdersToPlace[0]?.symbol)).then((res: object[]) => {
          if (res) {
            setStrategyOrders(res);
          }
        });
        close();
      }
    })
    .catch((err: any) => {
      dispatch(
        showSnackBar({
          src: "ORDER_CREATION_TPSL_FAILED",
          message: err.message,
          type: "failure"
        })
      );
      if (setLoading) setLoading(false);
      close();
    });
};

const cancelOrder = (order: any) => {
  return cancelOrderApi(order.symbol, order.ID);
};

interface CancelOrder {
  orders: any[];
  dispatch: Function;
  close: Function;
  setLoading: Function;
}
export const cancelOrderHelper = ({ orders, dispatch, close, setLoading }: CancelOrder) => {
  Promise.all(orders.map((order) => cancelOrder(order)))
    .then(() => {
      dispatch(
        showSnackBar({
          src: "ORDER_CANCELLATION_TPSL_SUCCESS",
          message: "TP/SL orders cancelled successfully",
          type: "success"
        })
      );
      if (setLoading) setLoading(false);
      close();
    })
    .catch((err) => {
      dispatch({
        src: "ORDER_CANCELLATION_TPSL_FAILED",
        message: err.message,
        type: "failure"
      });
      if (setLoading) setLoading(false);
      close();
    });
};

interface CancelAllOrdersProps {
  setLoading: Function;
  symbol: string;
  dispatch: Function;
  close: Function;
}
export const cancelAllStrategyOrdersHelper = ({ setLoading, symbol, dispatch, close }: CancelAllOrdersProps) => {
  if (setLoading) setLoading(true);
  cancelAllStrategyOrdersApi(symbol)
    .then(() => {
      dispatch(
        showSnackBar({
          src: "ORDER_CANCELLATION_TPSL_SUCCESS",
          message: "TP/SL orders cancelled successfully",
          type: "success"
        })
      );
      if (setLoading) setLoading(false);
      close();
    })
    .catch((err: any) => {
      dispatch(
        showSnackBar({
          src: "ORDER_CANCELLATION_TPSL_FAILED",
          message: err.message,
          type: "failure"
        })
      );
      if (setLoading) setLoading(false);
      close();
    });
};

interface ParentOrderProps {
  ID: string;
  symbol: string;
}
interface ActiveModalProps {
  parentOrder: ParentOrderProps;
  TPOrder: object;
  SLOrder: object;
}

interface CancelAllStrategyOrders {
  activeModalData: ActiveModalProps;
  setLoading: Function;
  dispatch: Function;
  close: Function;
}

export const cancelAllStrategyOrders = ({ activeModalData, setLoading, dispatch, close }: CancelAllStrategyOrders) => {
  if (!activeModalData.parentOrder) return;
  if (setLoading) setLoading(true);
  deleteStrategyOrderByID(activeModalData?.parentOrder?.symbol, activeModalData?.parentOrder?.ID)
    .then(() => {
      dispatch(
        showSnackBar({
          src: "ORDER_CANCELLATION_TPSL_SUCCESS",
          message: "TP/SL orders cancelled successfully",
          type: "success"
        })
      );
      if (setLoading) setLoading(false);
      close();
    })
    .catch((err: any) => {
      dispatch(
        showSnackBar({
          src: "ORDER_CANCELLATION_TPSL_FAILED",
          message: err.message,
          type: "failure"
        })
      );
      if (setLoading) setLoading(false);
    });
};
