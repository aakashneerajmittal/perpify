import React from "react";
import CustomModal from "./CustomModal";
import { Grid, Typography } from "@mui/material";
import CopyButton from "@/components/UI/CopyButton/CopyButton";

import PropTypes from "prop-types";
import TableNoRowsOverlay from "@/components/Setting/Rewards/TableNoRowsOverlay";
const TimestampConversion = (t) => {
  const d = new Date(t);
  // alert(d.toLocaleString());
  const options = { hour12: false };
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return d.toLocaleString(undefined, options).slice(0, -3) + ":" + seconds;
};
const OrderSummaryModal = ({ IsOpen, title, type, primaryName, secondaryAction, secondaryName, isSecondaryAction, isPrimaryAction, dataOrderId, updated, TotalFee, TotalPL, trades }) => {
  const formatData = (inputString) => {
    if (typeof inputString === "string") {
      return "****" + inputString.slice(-6);
    }
    return inputString;
  };
  const first = (inputString) => {
    const index = inputString.indexOf("|");

    if (index !== -1) {
      return inputString.substring(0, index);
    } else {
      return inputString;
    }
  };

  const second = (inputString) => {
    const index = inputString.split("|");

    if (index.length > 1) {
      return index[1].trim();
    }
    return " ";
  };
  const ShowContentType = (type) => {
    switch (type) {
      case "DISPLAY":
        return (
          <>
            <Grid sx={{ marginLeft: "28px", marginTop: "15px" }}>
              <Typography variant={"Medium_16"} component={"span"}>
                Order Summary
              </Typography>
            </Grid>
            <Grid
              item
              sx={{
                display: "flex",
                justifyContent: "space-between",
                marginLeft: "22px",
                marginRight: "28px",
                marginTop: "14px"
              }}
            >
              <Grid
                item
                sx={{
                  px: "14px",
                  paddingTop: "14px",
                  width: "125px",
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "background.default",
                  paddingRight: "0px"
                }}
              >
                <Typography variant={"Medium_11"} color={"text.secondary"} sx={{}}>
                  Order ID
                </Typography>
                <Typography component={"p"} variant={"Medium_12"} color={"text.primary"}>
                  {formatData(dataOrderId)}
                  <CopyButton fontSize={"14px"} copyText={formatData(dataOrderId)} />
                </Typography>
              </Grid>
              <Grid
                item
                sx={{
                  px: "14px",
                  py: "14px",
                  width: "auto",
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "background.default"
                }}
              >
                <Typography variant={"Medium_11"} color={"text.secondary"} sx={{}}>
                  Updated At
                </Typography>
                <Typography variant={"Medium_12"} color={"text.primary"} sx={{}}>
                  {TimestampConversion(updated)}
                </Typography>
              </Grid>
              <Grid
                item
                sx={{
                  px: "14px",
                  py: "14px",
                  width: "auto",
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "background.default",
                  paddingRight: "28px"
                }}
              >
                <Typography variant={"Medium_11"} color={"text.secondary"} sx={{}}>
                  Total Fee (USDC)
                </Typography>
                <Typography variant={"Medium_12"} color={"text.primary"} sx={{}}>
                  {TotalFee}
                </Typography>
              </Grid>
              <Grid
                item
                sx={{
                  px: "14px",
                  py: "14px",
                  width: "auto",
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "background.default",
                  paddingRight: "28px"
                }}
              >
                <Typography variant={"Medium_11"} color={"text.secondary"} sx={{}}>
                  Total P&L (USDC){" "}
                </Typography>
                <Typography variant={"Medium_12"} color={TotalPL > 0 ? "text.success" : "text.error"} sx={{}}>
                  {TotalPL}
                </Typography>
              </Grid>
            </Grid>
            <Grid item sx={{ marginTop: "25px", marginLeft: "28px" }}>
              <Typography variant={"Medium_16"}>Trades</Typography>
            </Grid>
            <Grid
              item
              sx={{
                marginTop: "15px",
                marginLeft: "28px",
                marginRight: "32px",
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between"
              }}
            >
              <Grid sx={{ width: "145px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"EXECUTION TIME"}
                </Typography>
              </Grid>
              <Grid sx={{ width: "127px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"TRADE ID"}
                </Typography>
              </Grid>
              <Grid sx={{ width: "120px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"EXECUTED SIZE"}
                </Typography>
              </Grid>
              <Grid sx={{ width: "95px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"P&L (USDC)"}
                </Typography>
              </Grid>
              <Grid sx={{ width: "90px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"ROLE"}
                </Typography>
              </Grid>
              <Grid sx={{ width: "85px" }}>
                <Typography variant={"Medium_10"} color={"text.secondary"}>
                  {"TRADING FEE"}
                </Typography>
              </Grid>
            </Grid>

            {trades?.length === 0 && <TableNoRowsOverlay message={"No Trades Data Available"} />}

            {trades?.map((item, index) => (
              <React.Fragment key={index}>
                <Grid
                  item
                  sx={{
                    marginTop: "10px",
                    marginLeft: "28px",
                    marginRight: "18px",
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between"
                  }}
                >
                  <Grid sx={{ width: "145px" }}>
                    <Typography component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {new Date(item.executionTime).toLocaleDateString()}
                    </Typography>
                    <Typography color={"text.regular"} component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {new Date(item.executionTime).toLocaleTimeString()}
                    </Typography>
                  </Grid>
                  <Grid sx={{ width: "127px", marginTop: "4px" }}>
                    <Typography component={"p"} variant={"Regular_12"} color={"text.default"}>
                      {formatData(item.tradeID)}
                      <CopyButton fontSize={"14px"} copyText={formatData(item.tradeID)} />
                    </Typography>
                  </Grid>
                  <Grid sx={{ width: "120px" }}>
                    <Typography component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {first(item.executedQuantity)}
                    </Typography>
                    <Typography color={"text.regular"} component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {second(item.executedQuantity)}
                    </Typography>
                  </Grid>
                  <Grid sx={{ width: "95px", marginTop: "5px" }}>
                    <Typography variant={"Regular_12"} color={item.PnL > 0 ? "text.success" : "text.error"}>
                      {item.PnL}
                    </Typography>
                  </Grid>
                  <Grid sx={{ width: "90px", marginTop: "5px" }}>
                    <Grid
                      item
                      sx={{
                        height: "22px",
                        width: "51px",
                        backgroundColor: "background.tertiary",
                        borderRadius: "4px",
                        display: "flex",
                        justifyContent: "space-around",
                        alignItems: "center"
                      }}
                    >
                      <Typography variant={"Regular_11"} color={"text.default"}>
                        {item.role}
                      </Typography>
                    </Grid>
                  </Grid>
                  <Grid sx={{ width: "100px" }}>
                    <Typography component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {first(item.tradingFee) + "USDT"}
                    </Typography>
                    <Typography color={"text.regular"} component={"p"} variant="Medium_12" id="orderHistory-rowdata-Time">
                      {second(item.tradingFee)}
                    </Typography>
                  </Grid>
                </Grid>
              </React.Fragment>
            ))}
          </>
        );
    }
  };
  return (
    <CustomModal
      IsOpen={IsOpen}
      close={secondaryAction}
      isClose={true}
      // label={"Order History"}
      isSecondaryAction={isSecondaryAction}
      secondaryAction={secondaryAction}
      // primaryAction={primaryAction}
      isPrimaryAction={isPrimaryAction}
      primaryButtonSX={{ width: "132px", height: "32px", marginRight: "18px" }}
      secondaryButtonSX={{ width: "132px", height: "32px" }}
      ContainerSx={{ width: "716px" }}
      // paddingSX={{ padding: "0px" }}
    >
      {ShowContentType(type)}
    </CustomModal>
  );
};

OrderSummaryModal.propTypes = {
  trades: PropTypes.array,
  IsOpen: PropTypes.bool,
  close: PropTypes.func,
  type: PropTypes.string,
  title: PropTypes.string,
  primaryName: PropTypes.string,
  secondaryName: PropTypes.string,
  toggleIsSupportChatVisible: PropTypes.func,
  isSupportChatVisible: PropTypes.bool,
  isPrimaryAction: PropTypes.bool,
  isSecondaryAction: PropTypes.bool,
  primaryAction: PropTypes.func,
  secondaryAction: PropTypes.func,
  dateRange: PropTypes.object,
  setDateRange: PropTypes.func,
  dataOrderId: PropTypes.string,
  updated: PropTypes.string,
  TotalFee: PropTypes.string,
  TotalPL: PropTypes.string
};
export default React.memo(OrderSummaryModal);
