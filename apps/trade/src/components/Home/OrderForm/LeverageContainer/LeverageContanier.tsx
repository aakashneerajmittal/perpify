import { LeverageToolTip } from "@/assets/strings/tooltip.string";
import CustomModal from "@/components/CustomModals/newModal/CustomModal";
import TextView from "@/components/UI/TextView/TextView";
import { ORDERFORM_CONSTANTS } from "@/frontend-BL/businessHooks/ORDER_FORM/Constants/Orderform_const";
import { changeLeverage } from "@/frontend-BL/redux/actions/Futures/SetLeverage.ac";
import { Box, Grid, Tooltip, Typography } from "@mui/material";
import React, { memo, useContext, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import BalanceLabel from "../BalanceLabel";
import OrderFormContext from "../OrderFormNewWrapper";
import LeverageSlider from "./LeverageSlider";
import MaximumBuyingPower from "./MaximumBuyingPower";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const LeverageContanier = () => {
  const dispatch = useDispatch();
  const selectedSymbol = useSelector((state: any) => state.selectSymbol.selectedSymbol);
  const [openLeverageModal, setOpenleverageModal] = useState(false);
  const leverageFromServer = useSelector((state: any) => state.positionsDirectory.leverage).find((item: { sym: any }) => item.sym === selectedSymbol.toUpperCase());
  const [leverage, setLeverage] = useState(1);
  const { state, dispatchOrderEvent } = useContext(OrderFormContext);
  // PERPIFY: the tier-gated leverage cap from the engine (SESSION_INFO.maxLeverage).
  // The slider maxes out here and the selected leverage is clamped to it, so a
  // tier-A wallet (4×) never shows or submits 10× and gets rejected by the venue.
  const engineMaxLev = useSelector((s: any) => Number(s.sessionInfo?.maxLeverage) || 0);
  const sliderMax = engineMaxLev || state.maxLeverage || 3;
  useEffect(() => {
    const fromServer = Number(leverageFromServer?.leverage) || 0;
    if (fromServer) {
      setLeverage(engineMaxLev ? Math.min(fromServer, engineMaxLev) : fromServer);
    }
  }, [leverageFromServer?.leverage, engineMaxLev]);
  useEffect(() => {
    if (engineMaxLev && leverage > engineMaxLev) setLeverage(engineMaxLev);
  }, [engineMaxLev, leverage]);

  const handleLeverageChange = (event: { target: any }) => {
    const value = event.target.value;
    setLeverage(value);
    dispatchOrderEvent({ type: "UPDATE_LEVERAGE_DISABLE", payload: false });
  };
  const errorCallBack = (error: any) => {
    dispatchOrderEvent({ type: "UPDATE_LEVERAGE_ERROR", payload: error });
    dispatchOrderEvent({ type: "UPDATE_LEVERAGE_DISABLE", payload: false });
  };
  const successCallBack = () => {
    dispatchOrderEvent({ type: "UPDATE_LEVERAGE_DISABLE", payload: true });
    setOpenleverageModal(false);
  };
  const confirm_leverage_change = () => {
    dispatch(changeLeverage(selectedSymbol.toUpperCase(), Number(leverage), errorCallBack, successCallBack));
  };

  return (
    <>
      <Box
        className="productTour__step5"
        sx={{
          cursor: "pointer",
          border: "1px solid",
          borderColor: "text.quaternary",

          px: 1.5,
          py: 1,
          borderRadius: "4px"
        }}
        id="orderForm-marginTypeChange-button"
        onClick={() => {
          setOpenleverageModal(!openLeverageModal);
        }}
      >
        <Grid container justifyContent={"space-between"} alignItems={"center"}>
          <Grid item xs={12}>
            <Tooltip
              componentsProps={{
                tooltip: {
                  sx: {
                    color: "#ffff",
                    fontSize: "11px",
                    backgroundColor: "background.tertiary",
                    fontWeight: 600,
                    p: "10px"
                  }
                }
              }}
              arrow
              placement="top"
              title={<TextView text={LeverageToolTip} />}
            >
              <Typography variant="Medium_12" textAlign={"center"} component={"h6"} sx={{ fontFamily: MONO_FAMILY }}>
                {leverage}
                <Typography variant="Regular_10" component={"span"}>
                  {" x"}
                </Typography>
              </Typography>
            </Tooltip>
          </Grid>
        </Grid>
      </Box>
      <CustomModal
        ContainerSx={{ maxWidth: { sm: "500px", xs: "320px" } }}
        secondaryName={"Dismiss"}
        secondaryAction={() => {
          handleLeverageChange({
            target: { value: leverageFromServer?.leverage }
          });
          successCallBack();
        }}
        isSecondaryAction={true}
        isDisabled={state.leverageDisable}
        primaryAction={confirm_leverage_change}
        isPrimaryAction={true}
        isClose={true}
        close={() => {
          handleLeverageChange({
            target: { value: leverageFromServer?.leverage }
          });
          successCallBack();
        }}
        IsOpen={openLeverageModal}
      >
        <Box>
          <Grid gap={1} rowSpacing={3} container>
            <Grid item xs={12}>
              {" "}
              <Typography id="Leverage-text" variant={"SemiBold_16"} component="p">
                {ORDERFORM_CONSTANTS.LEVERAGE_LABEL}
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <LeverageSlider handleLeverageChange={handleLeverageChange} leverage={leverage} maxLeverage={sliderMax} confirm_leverage_change={confirm_leverage_change} />
              <Typography color={"#EBB62F"} sx={{ textTransform: "capitalize" }} variant="Regular_12">
                {state.leverageError}
              </Typography>
            </Grid>

            <Grid item xs={5.6}>
              <Box
                sx={{
                  height: "100%",
                  borderRadius: "4px",
                  p: 1,
                  backgroundColor: "background.default"
                }}
              >
                <BalanceLabel />
              </Box>
            </Grid>
            <Grid item xs={5.6}>
              <Box
                sx={{
                  borderRadius: "4px",
                  height: "100%",
                  p: 1,
                  backgroundColor: "background.default"
                }}
              >
                <MaximumBuyingPower id="maximum-buying-power-leverage" alignment={"vertical"} leverage={leverage ?? 10} />
              </Box>
            </Grid>
          </Grid>
        </Box>
      </CustomModal>
    </>
  );
};

export default memo(LeverageContanier);
