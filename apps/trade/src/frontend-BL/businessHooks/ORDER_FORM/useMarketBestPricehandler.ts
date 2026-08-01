import { useMemo } from "react";
import { useSelector } from "react-redux";

interface useMarketBestPricehandlerProps {
  side: string;
  symbol: string;
}

const useMarketBestPricehandler = ({ side, symbol }: useMarketBestPricehandlerProps) => {
  const orderBookDirectory = useSelector((state: any) => state.OrderBook);
  const lastTradedPrice = useSelector((state: any) => state.BinanceStreamData.binanceData?.[`${symbol?.toLowerCase()}@ticker`]);

  const assumingPrice = useMemo(() => {
    if (orderBookDirectory?.asks?.length > 0 && orderBookDirectory?.bids?.length > 0) {
      if (side === "BUY") {
        return Number(orderBookDirectory.asks[0][0]) * (1 + 0.0005);
      } else if (side === "SELL") {
        return Number(orderBookDirectory.bids[0][0]);
      }
    }
    return Number(lastTradedPrice);
  }, [lastTradedPrice, orderBookDirectory, side]);

  return {
    assumingPrice,
    lastTradedPrice
  };
};

export default useMarketBestPricehandler;
