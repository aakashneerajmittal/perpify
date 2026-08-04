import React, { createContext, useEffect, useReducer } from "react";
import { Grid } from "@mui/material";
import CustomDivider from "../../../UI/Divider/CustomDivider";
import OrderBook from "./OrderBook/OrderBook";
import DepthBookChart from "./DepthBookChart/DepthBookChart";
import { useSelector } from "react-redux";
import worker from "./OrderBook/OrderBookWorker";

interface DepthChart {
  asks: number[];
  bids: number[];
}

interface OrderBookState {
  depthChart: DepthChart;
  orderBook: DepthChart;
  ticket: number;
}

type Action =
  | { type: "UPDATE_DEPTH_CHART"; payload: DepthChart }
  | { type: "UPDATE_ORDER_BOOK"; payload: DepthChart }
  | { type: "UPDATE_TICKET_SIZE"; payload: number }
  | { type: "UPDATE_TICKET_SIZE_ARR"; payload: any[] };

const initialState: OrderBookState = {
  depthChart: { asks: [], bids: [] },
  orderBook: { asks: [], bids: [] },
  ticket: 1
};

const reducer = (state: OrderBookState, action: Action): OrderBookState => {
  switch (action.type) {
    case "UPDATE_DEPTH_CHART":
      return { ...state, depthChart: action.payload };
    case "UPDATE_ORDER_BOOK":
      return { ...state, orderBook: action.payload };
    case "UPDATE_TICKET_SIZE":
      return { ...state, ticket: action.payload };
    // case "UPDATE_TICKET_SIZE_ARR":
    //   return { ...state, GroupArray: action.payload };
    default:
      return state;
  }
};

export const OrderBookAndDepthChartContext = createContext<{
  state: OrderBookState;
  dispatchOrderBookEvent: React.Dispatch<Action>;
}>({
  state: initialState,
  dispatchOrderBookEvent: () => null
});

const OrderBookAndDepthBookChartContainer: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const OrderBookl = useSelector((state: any) => state.OrderBook);

  useEffect(() => {
    if (OrderBookl.loading) {
      dispatch({ type: "UPDATE_DEPTH_CHART", payload: { asks: [], bids: [] } });
      dispatch({ type: "UPDATE_ORDER_BOOK", payload: { asks: [], bids: [] } });
    } else {
      dispatch({
        type: "UPDATE_DEPTH_CHART",
        payload: {
          asks: OrderBookl.asksSnapShot,
          bids: OrderBookl.bidsSnapShot
        }
      });
    }
  }, [OrderBookl.loading]);

  useEffect(() => {
    if (!OrderBookl.loading && (state.depthChart.asks.length > 0 || state.depthChart.bids.length > 0)) {
      worker.postMessage({
        type: "ORDER_BOOK",
        payload: {
          // PERPIFY: the engine streams a FULL order-book snapshot every tick (not Binance-style
          // deltas). Merging snapshots into the accumulated `currentLevel` left stale price levels
          // behind as the book drifted, so the book showed duplicated/interleaved rows and the
          // depth chart became a sawtooth. Feeding an empty currentLevel makes the worker treat
          // each snapshot as a clean replace.
          currentLevel: { asks: [], bids: [] },
          latestOrder: { asks: OrderBookl.asks, bids: OrderBookl.bids },
          ticket: state.ticket
        }
      });
    } else {
      worker.postMessage({
        type: "ORDER_BOOK",
        payload: {
          currentLevel: [],
          latestOrder: { asks: [], bids: [] },
          ticket: state.ticket
        }
      });
    }

    worker.onmessage = ({ data }) => {
      const { type, message } = data;
      switch (type) {
        case "DEPTH_BOOK": {
          dispatch({
            type: "UPDATE_DEPTH_CHART",
            payload: {
              asks: message.updatedAsksStream,
              bids: message.updatedBidsStream
            }
          });
          break;
        }
        case "ORDER_BOOK": {
          dispatch({
            type: "UPDATE_ORDER_BOOK",
            payload: {
              asks: message.updatedAsksStreamOrderBook,
              bids: message.updatedBidsStreamOrderBook
            }
          });
          break;
        }
        default:
          break;
      }
    };
  }, [OrderBookl]);

  return (
    <OrderBookAndDepthChartContext.Provider
      value={{
        state,
        dispatchOrderBookEvent: dispatch
      }}
    >
      <Grid container height={"100%"} justifyContent={"space-between"}>
        <Grid sx={{ display: { xs: "none", sm: "block" } }} sm={8.4} height={"100%"}>
          <DepthBookChart />
        </Grid>
        <CustomDivider alignment={"vertical"} />
        <Grid height={"100%"} xs={12} sm={3.5}>
          <OrderBook />
        </Grid>
      </Grid>
    </OrderBookAndDepthChartContext.Provider>
  );
};

export default OrderBookAndDepthBookChartContainer;
