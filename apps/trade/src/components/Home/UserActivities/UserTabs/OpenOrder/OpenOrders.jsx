/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */

// Mui
import { TableCell, Tooltip, Box, Grid, Typography } from "@mui/material";

import InfoIcon from "@mui/icons-material/Info";
import { getRowColor } from "@/helpers";
import { numberWithCommas } from "@/helpers/commaHelper";
// React, redux, hooks
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ORDER_CREATION_SUCESS, ORDER_CREATION_FAIL } from "BL/redux/constants/Constants";
// Assets, strings, constants
import { OpenOrderSubHeader } from "../../UserActivitiesObjects";
import { tablePositionCategoryStyle2 } from "../UserTabs.style";
// Apis
import { cancelOrderApi, getStrategyOrderDataByIDApi } from "API/Api";

import PropTypes from "prop-types";
import NewOCOTOModal from "@/components/CustomModals/OCOModals/OTOCONewModal";
import { showSnackBar } from "@/frontend-BL/redux/actions/Internal/GlobalErrorHandler.ac";
import { fetchFutureAccountDetails } from "@/frontend-BL/redux/actions/Futures/Futures.ac";
import CustomButton from "@/components/UI/CustomButton/CustomButton";
import TableNoRowsOverlay from "@/components/Setting/Rewards/TableNoRowsOverlay";
import { getCurrencyUrl } from "@/helpers/CurrencyLogo";

const OpenOrders = () => {
  const dispatch = useDispatch();
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [CancelOrderApistatus, setCancelOrderApiStatus] = useState(false);
  const openOrdersApiData = useSelector((state) => state.futures.openOrders);
  const openOrdersSocketData = useSelector((state) => state.OpenOrdersStream.OpenOrdersStream);
  const [showOCOTreeModal, setShowOCOTreeModal] = useState({
    IsOpen: false,
    props: {}
  });
  const handleShowOCOTreeModalData = useCallback(
    (data) => {
      setShowOCOTreeModal({ IsOpen: true, props: { activeModalData: data } });
    },
    [showOCOTreeModal]
  );
  // const [showChildOCOTreeModal, setShowChildOCOTreeModal] = useState(false);
  const CANCEL = "Cancel";
  const NO_OPEN_ORDERS_TEXT = "No open orders currently";
  const trueFalseMap = (val) => {
    return val === false ? "No" : "Yes";
  };
  function closeOrder(orderId, symbol) {
    cancelOrderApi(symbol, orderId)
      .then(() => {
        setCancelOrderApiStatus(false);
        dispatch(fetchFutureAccountDetails());
        dispatch(
          showSnackBar({
            src: ORDER_CREATION_SUCESS,
            message: "Your order has been cancelled successfully",
            type: "success"
          })
        );
      })
      .catch(() => {
        setCancelOrderApiStatus(false);
        dispatch(
          showSnackBar({
            src: ORDER_CREATION_FAIL,
            message: "Order could not be cancelled. We apologize!",
            type: "failure"
          })
        );
      });
  }
  const handleChange = (data) => {
    navigator.clipboard.writeText(data);
    setSelectedOrderId(data);
  };
  const [showTPSLColumn, setShowTPSLColumn] = useState(true);

  // Open orders row API data
  function OpenOrdersRow({ rowData, index, handleOCOTreeModal, setShowTPSLColumn }) {
    const handleClick = (e) => {
      if (rowData.reduceOnly || !rowData.hasSiblingOrders) {
        return;
      }
      getStrategyOrderDataByIDApi(rowData.ID)
        .then((res) => {
          if (res) {
            // setIsEyeIcon(true);
            const orders = res.data.orders;
            const temp = {};
            const parentOrder = orders.find((order) => !order.reduceOnly);
            const TPOrder = orders.find((order) => order.type === "TAKE_PROFIT_MARKET" && order.reduceOnly);
            const SLOrder = orders.find((order) => order.type === "STOP_MARKET" && order.reduceOnly);
            if (parentOrder) temp.parentOrder = parentOrder;
            if (TPOrder) temp.TPOrder = TPOrder;
            if (SLOrder) temp.SLOrder = SLOrder;
            handleOCOTreeModal({ parentOrder, TPOrder, SLOrder });
          }
        })
        .catch((err) => {
          // setIsEyeIcon(false);
          console.log(err);
        });
    };
    return (
      <>
        <Grid
          id={"openOrder-Row-" + index}
          container
          justifyContent={"space-between"}
          alignItems={"center"}
          key={rowData.ID}
          p={2.5}
          sx={
            {
              // backgroundColor: getRowColor(1)
            }
          }
        >
          <Grid item xs={1}>
            <Box id="openOrder-Rowdata-CreatedAT">
              <Typography component={"p"} variant="medium_12_500">
                {new Date(rowData.createdAt).toLocaleDateString()}
              </Typography>
              <Typography color={"text.regular"} component={"p"} variant="medium_12_500">
                {new Date(rowData.createdAt).toLocaleTimeString()}
              </Typography>
            </Box>
          </Grid>
          <Grid container gap={0.5} alignItems={"center"} item xs={1.2}>
            <Box
              component={"img"}
              src={getCurrencyUrl(rowData?.symbol.toUpperCase().replace("USDT", "").toLowerCase())}
              alt="symbolLogo"
              sx={{
                height: "25px",
                width: "25px",
                borderRadius: "50%",
                backgroundColor: "white"
              }}
            />

            <Typography id="orderHistory-Symbole" variant="medium_12_500">
              {rowData.symbol.toUpperCase()}
            </Typography>
          </Grid>

          <Grid item xs={1.4}>
            <Typography variant="medium_12_500" color={"text.regular"} id="openOrder-rowData-Type">
              {rowData.type}
            </Typography>
          </Grid>
          <Grid item xs={1}>
            <Typography
              id={`openOrder-Side-${rowData.side === "BUY" ? "LONG" : "SHORT"}`}
              variant="medium_12_500"
              sx={{
                color: rowData.side === "BUY" ? "text.success" : "text.error",
                textAlign: "center"
              }}
            >
              {rowData.side === "BUY" ? "LONG" : "SHORT"}
            </Typography>
          </Grid>
          <Grid item xs={1}>
            <Typography variant="medium_12_500" id="openOrder-rowData-Price">
              {rowData.price !== 0 && rowData.price !== "0" ? numberWithCommas(Number(rowData.price)) : "--"}
            </Typography>
          </Grid>
          <Grid item xs={1.2}>
            <Typography variant="medium_12_500" id="openOrder-Stop-Price">
              {rowData.stopPrice !== 0 && rowData.stopPrice !== "0" ? rowData.stopPrice : "--"}
            </Typography>
          </Grid>
          <Grid item xs={1.2}>
            <Box id="openOrder-rowData-Qty">
              <Typography variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.quantity))} {rowData?.symbol.toUpperCase().replace("USDT", "")}
              </Typography>
              <Typography variant="medium_12_500" color={"text.regular"} component={"p"}>
                {(rowData.price !== 0 && rowData.price !== "0" ? rowData.quantity * rowData.price : rowData.quantity * rowData.stopPrice).toFixed(2)} {" USDT"}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={1.2}>
            <Box id="openOrder-executedQuantity">
              <Typography variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.executedQuantity))}
                {" of"}
              </Typography>
              <Typography color={"text.regular"} variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.quantity))} {rowData?.symbol.toUpperCase().replace("USDT", "")}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={1}>
            <Typography variant="medium_12_500" id="openOrder-Filled-Data">
              {trueFalseMap(rowData.reduceOnly)}
            </Typography>
          </Grid>

          <Grid item xs={0.8}>
            <Typography id="openOrder-TP-SL-Data">
              {/* {numberWithCommas(Number(rowData.executedQuantity))} */}

              <Typography
                sx={{
                  textDecoration: "underline",
                  cursor: rowData.hasSiblingOrders && !rowData.reduceOnly && "pointer"
                }}
                onClick={handleClick}
                color={rowData.hasSiblingOrders && !rowData.reduceOnly ? "white" : "text.regular"}
                variant="medium_12_500"
              >
                {"TP/SL"}
              </Typography>
            </Typography>
          </Grid>

          <Grid item xs={0.8}>
            <TableCell sx={tablePositionCategoryStyle2}>
              <CustomButton
                id="openOrder-Cancel-Btn"
                label={CANCEL}
                isDisabled={CancelOrderApistatus}
                isloading={CancelOrderApistatus}
                style={{ fontSize: "10px", p: "1px 10px" }}
                loadingTextDisable={true}
                onClick={() => {
                  setCancelOrderApiStatus(true);
                  closeOrder(rowData.ID, rowData.symbol);
                }}
              />
            </TableCell>
          </Grid>
        </Grid>
      </>
    );
  }

  const restApiData = useMemo(
    () =>
      openOrdersApiData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) &&
      openOrdersApiData !== undefined &&
      openOrdersApiData?.map((rowData, index) => <OpenOrdersRow rowData={rowData} index={index} key={index} handleOCOTreeModal={handleShowOCOTreeModalData} setShowTPSLColumn={setShowTPSLColumn} />),
    [openOrdersApiData, selectedOrderId, CancelOrderApistatus, showTPSLColumn]
  );

  function OpenOrdersStreamRow({ rowData, index, handleOCOTreeModal, showTPSLColumn }) {
    const [isEyeIcon, setIsEyeIcon] = useState(false);
    const handleClick = (e) => {
      if (!isEyeIcon || rowData.R) {
        return;
      }
      getStrategyOrderDataByIDApi(rowData.c)
        .then((res) => {
          if (res) {
            const orders = res.data.orders;
            const temp = {};
            const parentOrder = orders.find((order) => !order.reduceOnly);
            const TPOrder = orders.find((order) => order.type === "TAKE_PROFIT_MARKET" && order.reduceOnly);
            const SLOrder = orders.find((order) => order.type === "STOP_MARKET" && order.reduceOnly);
            if (parentOrder) temp.parentOrder = parentOrder;
            if (TPOrder) temp.TPOrder = TPOrder;
            if (SLOrder) temp.SLOrder = SLOrder;
            handleOCOTreeModal({ parentOrder, TPOrder, SLOrder });
          }
        })
        .catch((err) => {
          console.log(err);
        });
    };
    useEffect(() => {
      if (rowData.c) {
        getStrategyOrderDataByIDApi(rowData.c)
          .then((res) => {
            if (res) {
              setIsEyeIcon(true);
            }
          })
          .catch((err) => {
            setIsEyeIcon(false);
            console.log(err);
          });
      }
    }, [rowData.c]);
    return (
      <>
        <Grid
          container
          p={2.5}
          alignItems="center"
          justifyContent={"space-between"}
          key={rowData.i}
          // sx={{
          //   // backgroundColor: getRowColor(1),
          //   "&:hover": {
          //     // background: "background.secondary"
          //   }
          // }}
        >
          <Grid item xs={1}>
            <Box id="openOrder-Rowdata-CreatedAT">
              <Typography component={"p"} variant="medium_12_500">
                {new Date(rowData.T).toLocaleDateString()}
              </Typography>
              <Typography color={"text.regular"} component={"p"} variant="medium_12_500">
                {new Date(rowData.T).toLocaleTimeString()}
              </Typography>
            </Box>
          </Grid>
          <Grid container gap={0.5} alignItems={"center"} item xs={1.2}>
            <Box
              component={"img"}
              src={getCurrencyUrl(rowData?.s.toUpperCase().replace("USDT", "").toLowerCase())}
              alt="symbolLogo"
              sx={{
                height: 18,
                width: 18,
                mt: "4px",
                borderRadius: "50%",
                backgroundColor: "white"
              }}
            />

            <Typography id="orderHistory-Symbole" variant="Bold_12">
              {rowData.s.toUpperCase()}
            </Typography>
          </Grid>
          <Grid item xs={1.4}>
            <Typography variant="medium_12_500" color={"text.regular"} id="openOrder-rowData-Type">
              {rowData.o}
            </Typography>
          </Grid>
          <Grid item xs={1}>
            <Typography
              id={`openOrder-Side-${rowData.S === "BUY" ? "LONG" : "SHORT"}`}
              variant="medium_12_500"
              sx={{
                color: rowData.S === "BUY" ? "text.success" : "text.error",
                textAlign: "center"
              }}
            >
              {rowData.S === "BUY" ? "LONG" : "SHORT"}
            </Typography>
          </Grid>
          <Grid item xs={1}>
            <Typography variant="medium_12_500" id="openOrder-rowData-Price">
              {rowData.p !== 0 && rowData.p !== "0" ? numberWithCommas(Number(rowData.p)) : "--"}
            </Typography>
          </Grid>
          <Grid item xs={1.2}>
            <Typography variant="medium_12_500" id="openOrder-Stop-Price">
              {rowData.sp !== 0 && rowData.sp !== "0" ? rowData.sp : "--"}
            </Typography>
          </Grid>
          <Grid item xs={1.2}>
            <Box id="openOrder-rowData-Qty">
              <Typography variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.q))} {rowData?.s.toUpperCase().replace("USDT", "")}
              </Typography>
              <Typography variant="medium_12_500" color={"text.regular"} component={"p"}>
                {(rowData.p !== 0 && rowData.p !== "0" ? rowData.q * rowData.p : rowData.q * rowData.sp).toFixed(2)}
                {" USDT"}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={1.2}>
            <Box id="openOrder-executedQuantity">
              <Typography variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.l))}
                {" of"}
              </Typography>
              <Typography color={"text.regular"} variant="medium_12_500" component={"p"}>
                {numberWithCommas(Number(rowData.q))} {rowData?.s.toUpperCase().replace("USDT", "")}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={1}>
            <Typography variant="medium_12_500" id="openOrder-Filled-Data">
              {trueFalseMap(rowData.R)}
            </Typography>
          </Grid>

          <Grid item xs={0.8}>
            <Typography
              sx={{
                textDecoration: "underline",
                cursor: isEyeIcon && !rowData.R && "pointer"
              }}
              onClick={handleClick}
              color={isEyeIcon && !rowData.R ? "white" : "text.regular"}
              variant="medium_12_500"
            >
              {"TP/SL"}
            </Typography>
          </Grid>

          <Grid item xs={0.8}>
            <TableCell sx={tablePositionCategoryStyle2}>
              <CustomButton
                label={CANCEL}
                isDisabled={CancelOrderApistatus}
                isloading={CancelOrderApistatus}
                style={{ fontSize: "10px", p: "1px 10px" }}
                loadingTextDisable={true}
                onClick={() => {
                  setCancelOrderApiStatus(true);
                  closeOrder(rowData.c, rowData.s);
                }}
              />
            </TableCell>
          </Grid>
        </Grid>
      </>
    );
  }
  const webSocketData = useMemo(
    () =>
      openOrdersApiData.sort((a, b) => new Date(b.T) - new Date(a.T)) &&
      openOrdersSocketData !== undefined &&
      openOrdersSocketData?.map((rowData, index) => (
        <OpenOrdersStreamRow rowData={rowData} key={index} index={index} handleOCOTreeModal={handleShowOCOTreeModalData} showTPSLColumn={showTPSLColumn} />
      )),
    [openOrdersSocketData, selectedOrderId, CancelOrderApistatus, showTPSLColumn]
  );

  return (
    <>
      <Box>
        <Grid container justifyContent={"space-between"} alignItems={"center"} p={"20px 10px 20px 20px"}>
          {OpenOrderSubHeader.map(
            (headerData, i) =>
              (showTPSLColumn || headerData.id !== 8) && (
                <Grid key={i} xs={headerData.gridSize}>
                  <Box
                    sx={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    <Typography color={"text.regular"} textTransform={"uppercase"} variant="medium_12_700" component={"h6"}>
                      {headerData.name}
                    </Typography>
                    <Tooltip title={headerData.tooltip} placement="top">
                      {headerData.tooltip && (
                        <InfoIcon
                          sx={{
                            cursor: "pointer",
                            fontSize: "14px",
                            color: "#A9A9A9",
                            marginLeft: "4px"
                          }}
                        />
                      )}
                    </Tooltip>
                  </Box>
                </Grid>
              )
          )}
        </Grid>
        {openOrdersApiData?.length === 0 && openOrdersSocketData?.length === 0 && (
          <>
            <Grid my={2}>
              <TableNoRowsOverlay message={NO_OPEN_ORDERS_TEXT} />
            </Grid>
          </>
        )}
        <Box
          sx={{
            // pr: "20px",
            overflow: "auto",
            maxHeight: "300px"
          }}
        >
          {restApiData}
          {webSocketData}
        </Box>
      </Box>
      {showOCOTreeModal.IsOpen && (
        <>
          <NewOCOTOModal IsOpen={showOCOTreeModal} close={() => setShowOCOTreeModal({ ...showOCOTreeModal, IsOpen: false })} activeModalData={showOCOTreeModal?.props?.activeModalData} />
        </>
      )}
    </>
  );
};
OpenOrders.propTypes = {
  index: PropTypes.number
};

export default memo(OpenOrders);
