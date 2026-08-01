import { Box } from "@mui/material";
import React, { useContext, useMemo, useRef } from "react";
import { SymbolPrecisionHelper } from "../../../../../helpers";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import Loader from "@/helpers/Loader";
import LastTradedPrice from "@/components/LastTradedPrice/LastTradedPrice";
import { OrderBookAndDepthChartContext } from "../OrderBookAndRecentTradesContainer";
import OrderBookRow from "./OrderBookRow";
const OrderBookTable = ({ asksOrBids }: { asksOrBids: string }) => {
  const ref = useRef(null);
  const refForInnerContainerAsk = useRef(null);
  const refForInnerContainerBids = useRef(null);
  const symbol = useSelector((state: any) => state.selectSymbol.selectedSymbol);
  const { ChangeInAsset } = useSelector((state: any) => state.ChangeInAsset);
  const { state } = useContext(OrderBookAndDepthChartContext);
  const OrderBookl = useSelector((state: any) => state.OrderBook);
  const { convertToPrecisionValueInContractAssetUnit, setDecimalPrecision, symbolPricePrecision, symbolQuantityPrecision } = SymbolPrecisionHelper({ symbol });
  const askslength = useMemo(() => {
    const a = [...state.orderBook.asks];
    const asks = a.reverse();
    return (
      <>
        {asks.slice(asks.length - convertToPrecisionValueInContractAssetUnit(String(refForInnerContainerAsk.current?.offsetHeight / 25), 0)).map((items, index) => {
          const asksMax = asks.length && asks.slice(asks.length - convertToPrecisionValueInContractAssetUnit(String(refForInnerContainerAsk.current?.offsetHeight / 23), 0))[0][2];
          return (
            <Box key={index}>
              <OrderBookRow
                items={items}
                Max={asksMax}
                setDecimalPrecision={setDecimalPrecision}
                rowType="ASK"
                symbolQuantityPrecision={symbolQuantityPrecision}
                symbolPricePrecision={symbolPricePrecision}
              />
            </Box>
          );
        })}
      </>
    );
  }, [state.orderBook, asksOrBids, refForInnerContainerAsk.current?.offsetHeight, ref.current?.offsetHeight, ChangeInAsset]);
  const bid = useMemo(() => {
    const b = [...state.orderBook.bids];

    const bids = b.slice(0, convertToPrecisionValueInContractAssetUnit(String(refForInnerContainerBids.current?.offsetHeight / 25), 0));
    const bidsMax = bids.length && bids[bids.length - 1][2];
    return (
      <>
        {bids?.map((items, index) => {
          return (
            <Box key={index}>
              <OrderBookRow
                setDecimalPrecision={setDecimalPrecision}
                items={items}
                Max={bidsMax}
                rowType="BID"
                symbolQuantityPrecision={symbolQuantityPrecision}
                symbolPricePrecision={symbolPricePrecision}
              />
            </Box>
          );
        })}
      </>
    );
  }, [state.orderBook, asksOrBids, refForInnerContainerBids.current, ref.current?.offsetHeight, ChangeInAsset]);
  return (
    <Box sx={{ height: "calc(100% - 60px)", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {OrderBookl.loading && <Loader circular={true} />}
      {!OrderBookl.loading && (
        <Box height={"100%"} width={"100%"} overflow={"hidden"} ref={ref}>
          {(asksOrBids === "ALL" || asksOrBids === "ASKS") && (
            <Box
              display={"flex"}
              flexDirection="column"
              gap={"1px"}
              ref={refForInnerContainerAsk}
              overflow={"hidden"}
              height={asksOrBids === "ALL" ? `${ref.current?.offsetHeight / 2 - 20}px` : `${ref.current?.offsetHeight - 40}px`}
            >
              <>{askslength}</>
            </Box>
          )}
          <Box
            sx={{
              // backgroundColor: "background.default",
              py: 1,
              height: "40px",
              borderRadius: "4px",
              textAlign: "left"
            }}
          >
            <LastTradedPrice id={"orderbook-ltp"} arrow symbolPricePrecision={symbolPricePrecision} variant="SemiBold_18" convertToPrecisionValueForPrice={setDecimalPrecision} symbol={symbol} />
          </Box>
          {(asksOrBids === "ALL" || asksOrBids === "BIDS") && (
            <Box
              display={"flex"}
              flexDirection="column"
              gap={"1px"}
              ref={refForInnerContainerBids}
              overflow={"hidden"}
              height={asksOrBids === "ALL" ? `${ref.current?.offsetHeight / 2 - 20}px` : `${ref.current?.offsetHeight - 40}px`}
            >
              {bid}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
OrderBookTable.propTypes = {
  asksOrBids: PropTypes.string
};
export default OrderBookTable;
