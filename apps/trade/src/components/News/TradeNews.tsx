import { Box, Typography } from "@mui/material";
import React, { useEffect, useState } from "react";
import { newContainer, newContainerHeading, newsTabContainer, tradeCards } from "./TradeNews.Style";
import Loader from "@/helpers/Loader";

import { LinkButton } from "../UI/LinkButton";
import TradeCards from "./TradeCards";
import TradeNewsCardRow from "./TradeNewsCardRow";
import { TradeNewsMarketData } from "./TradeNews.type";

import { getTradableCoins } from "@/frontend-BL/redux/actions/Futures/GetTradableCoins.ac";
import { FETCH_MARKET_NEWS } from "@/frontend-BL/redux/actions/Market/getMarketData.ac";

import { useDispatch } from "react-redux";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

const TradeNews = () => {
  const [topic, setTopic] = useState("all");
  const [marketNewsData, setMarketNewsData] = useState([]);

  const [loader, setloader] = useState(false);

  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    const newsTopic = topic === "all" ? "" : topic;
    dispatch(FETCH_MARKET_NEWS({ topic: newsTopic, setloader })).then((res) => {
      setMarketNewsData(res.data);
    });
  }, [topic]);

  const [cardData, setCardData] = useState({
    topFiveGainers: [],
    topFiveLosers: []
  });

  const activeSymbolsData = useSelector((state: any) => state.activeSymbolData);
  const { activeSymbols } = activeSymbolsData;

  useEffect(() => {
    getTradableCoins();
  }, []);

  useEffect(() => {
    if (activeSymbols.length !== 0) {
      const copiedActiveSymbols = JSON.parse(JSON.stringify(activeSymbols));
      const sortedActiveSymbols = copiedActiveSymbols.sort((a: any, b: any) => a.percentage - b.percentage);
      setCardData({
        topFiveLosers: sortedActiveSymbols.slice(0, 5).map((coinData: any) => ({
          Symbol: coinData?.symbol,
          id: coinData?.symbol,
          change: coinData?.percentage,
          value: coinData?.vol
        })),
        topFiveGainers: sortedActiveSymbols
          .reverse()
          .slice(0, 5)
          .map((coinData: any) => ({
            Symbol: coinData?.symbol,
            id: coinData?.symbol,
            change: coinData?.percentage,
            value: coinData?.vol
          }))
      });
    }
  }, [activeSymbols]);

  return (
    <Box sx={newsTabContainer}>
      <Box sx={tradeCards}>
        <TradeCards data={cardData.topFiveGainers} label={"Top 5 Gainers"} />
        <TradeCards data={cardData.topFiveLosers} label={"Top 5 Dippers"} />
      </Box>
      {/* <CustomDivider alignment={"vertical"} /> */}
      <Box sx={newContainer}>
        <Typography variant="Bold_16" sx={newContainerHeading}>
          AROUND THE CRYPTO WORLD
        </Typography>

        {loader && (
          <Box sx={{ mt: 5, height: "calc(100% - 120px)", overflow: "auto" }}>
            {marketNewsData &&
              (() => {
                const newsItems = [];
                for (let i = 0; i < 10 && i < marketNewsData.length; i++) {
                  const el: TradeNewsMarketData = marketNewsData[i];
                  newsItems.push(<TradeNewsCardRow key={el?.title} {...el} />);
                }
                return newsItems;
              })()}
          </Box>
        )}
        {!loader && (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Loader />
          </Box>
        )}

        <LinkButton isDisabled={false} color="neutral.black" onClick={() => navigate("/market/all-news")} label={"View All News"} />
      </Box>
    </Box>
  );
};

export default React.memo(TradeNews);
