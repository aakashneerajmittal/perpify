import React, { memo, useContext, useEffect } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { Box } from "@mui/material";
import { OrderBookAndDepthChartContext } from "../OrderBookAndRecentTradesContainer";
import { useSelector } from "react-redux";

const DepthBookChart = () => {
  const { state } = useContext(OrderBookAndDepthChartContext);
  const { ChangeInAsset } = useSelector((state: any) => state.ChangeInAsset);
  useEffect(() => {
    // Highcharts configuration options
    if (state.depthChart.asks && state.depthChart.bids) {
      // Render the chart
      const options = {
        chart: {
          height: "calc(100% - 10px)",
          type: "area",
          backgroundColor: "#1B1B1F",
          borderColor: "#1B1B1F",
          borderWidth: 0,
          labels: {
            style: {
              color: "white"
            }
          }
        },
        title: {
          style: {
            color: "#8B8B97",
            fontSize: "14px",
            fontWeight: 400
          },
          text: "Market Depth"
        },
        xAxis: {
          labels: {
            style: {
              margin: "20px",
              fontSize: "10px",
              color: "#8B8B97"
            }
          },
          minPadding: 0,
          maxPadding: 0,
          plotLines: [
            {
              color: "#1B1B1F",
              value: 0.1523,
              width: 10,
              label: {
                rotation: 90
              }
            }
          ],
          title: {
            text: "PRICE (USDC)",
            style: {
              color: "#8B8B97",
              fontSize: "10px"
            }
          }
        },
        yAxis: [
          {
            labels: {
              style: {
                fontSize: "11px",
                color: "#8B8B97"
              }
            },
            gridLineColor: "#1B1B1F",
            lineWidth: 0.1,
            gridLineWidth: 1,
            tickWidth: 1,
            tickLength: 5,
            tickPosition: "inside",
            title: {
              text: `SIZE ${ChangeInAsset ? "" : "(USDC)"}`,
              style: {
                color: "#8B8B97",
                fontSize: "10px"
              }
            }
          },
          {
            opposite: true,
            linkedTo: 0,
            lineWidth: 1,
            gridLineWidth: 0,
            title: null,
            tickWidth: 1,
            tickLength: 5,
            tickPosition: "inside",
            labels: {
              style: {
                fontSize: "11px",
                color: "#8B8B97"
              },
              align: "right",
              x: -8
            }
          }
        ],
        legend: {
          enabled: false,
          itemStyle: {
            color: "#8B8B97",
            fontWeight: "bold"
          }
        },
        plotOptions: {
          area: {
            fillOpacity: 0.1,
            lineWidth: 1
          }
        },
        series: [
          {
            name: "Bids",
            data: ChangeInAsset
              ? state.depthChart?.bids.map((item: string[][]) => [Number(item[0]), Number(item[2])])
              : state.depthChart?.bids.map((item: string[][]) => [Number(item[0]), Number(item[2]) * Number(item[0])]),

            color: "#29B57E"
          },
          {
            name: "Asks",
            data: ChangeInAsset
              ? state.depthChart?.asks.map((item: string[][]) => [Number(item[0]), Number(item[2])])
              : state.depthChart?.asks.map((item: string[][]) => [Number(item[0]), Number(item[2]) * Number(item[0])]),
            color: "#FF6554"
          }
        ]
      };

      Highcharts.chart("container", options);
      Highcharts.setOptions({
        plotOptions: {
          series: {
            animation: false
          }
        }
      });
    }
  }, [state.depthChart, ChangeInAsset]); // Ensure that this effect runs only once on component mount

  return (
    <Box height={"100%"} id="container">
      {" "}
      <HighchartsReact highcharts={Highcharts} options={{}} constructorType={"chart"} />
    </Box>
  );
};

export default memo(DepthBookChart);
