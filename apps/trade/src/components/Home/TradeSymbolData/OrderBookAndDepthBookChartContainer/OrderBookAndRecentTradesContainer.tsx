import React, { createContext, useEffect, useReducer } from "react";
import { Box, Grid } from "@mui/material";
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

const OrderBookAndDepthBookChartContainer: React.FC<{ ladderOnly?: boolean }> = ({ ladderOnly = false }) => {
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
    // Gate on the SOURCE book (OrderBookl.asks/bids), not on state.depthChart. depthChart is set
    // asynchronously by the effect above, so on the first tick after mount its closure was still
    // empty — the book then posted an empty payload and (for a static book that doesn't re-tick)
    // never recovered. This was invisible while the book only mounted on its tab (data already
    // flowing); as an always-on column it mounts before the first snapshot and lost the race.
    const bookAsks = OrderBookl.asks || [];
    const bookBids = OrderBookl.bids || [];
    if (!OrderBookl.loading && (bookAsks.length > 0 || bookBids.length > 0)) {
      worker.postMessage({
        type: "ORDER_BOOK",
        payload: {
          // PERPIFY: the engine streams a FULL order-book snapshot every tick (not Binance-style
          // deltas). Feeding an empty currentLevel makes the worker treat each snapshot as a clean
          // replace, so stale price levels don't accumulate.
          currentLevel: { asks: [], bids: [] },
          latestOrder: { asks: bookAsks, bids: bookBids },
          ticket: state.ticket
        }
      });
    } else {
      worker.postMessage({
        type: "ORDER_BOOK",
        payload: {
          currentLevel: { asks: [], bids: [] },
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
      {ladderOnly ? (
        // narrow always-on column: just the bid/ask ladder, full width, no depth chart.
        <Box height={"100%"} width={"100%"}>
          <OrderBook />
        </Box>
      ) : (
        <Grid container height={"100%"} justifyContent={"space-between"}>
          <Grid sx={{ display: { xs: "none", sm: "block" } }} sm={8.4} height={"100%"}>
            <DepthBookChart />
          </Grid>
          <CustomDivider alignment={"vertical"} />
          <Grid height={"100%"} xs={12} sm={3.5}>
            <OrderBook />
          </Grid>
        </Grid>
      )}
    </OrderBookAndDepthChartContext.Provider>
  );
};

export default OrderBookAndDepthBookChartContainer;
