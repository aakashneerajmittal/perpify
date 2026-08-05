import React from "react";
import PropTypes from "prop-types";
import { Box, Grid } from "@mui/material";
import OrderTypeTabs from "./OrderTypeTabs";
import BalanceLabel from "./BalanceLabel";
import OrderformSubmit from "./OrderformSubmit";
import { ORDERfORM } from "./style";
import MarginTypeButton from "./MarginTypeButton";
import { OrderFormNewWrapper } from "./OrderFormNewWrapper";
import TakeProfitStopLoss from "./TakeProfitStopLoss/TakeProfitStopLoss";
import QuantityLimitTriggerFieldWrapper from "./QuantityLimitTriggerFieldWrapper/QuantityLimitTriggerFieldWrapper";
import LeverageContanier from "./LeverageContainer";

import LockedOutScreen from "./LockedOutScreen";
import SignalTradingSwicth from "./SignalTradingSwicth";
import CustomDivider from "../../UI/Divider/CustomDivider";
import TierCard from "@/components/Tier/TierCard";
import LivingMargin from "./LivingMargin";
import SideToggle from "./SideToggle";

function OrderForm() {
  return (
    <OrderFormNewWrapper>
      <Box sx={[ORDERfORM]}>
        <TierCard />
        {/* Buy/Long · Sell/Short lives at the top of the ticket now (moved out of the header). */}
        <SideToggle />
        <Box
          sx={{
            p: "0px 8px 0px 8px",

            backgroundColor: "background.primary"
          }}
        >
          <Grid container gap={0.5} rowGap={1.2} justifyContent={"space-between"} alignItems={"center"}>
            <Grid container gap={0.5} alignItems={"center"} justifyContent={"space-between"} item>
              <BalanceLabel />
            </Grid>

            <Grid xs={2.5} item>
              <LeverageContanier />
            </Grid>

            <Grid xs={3.5} item>
              <Box className="productTour__step3">
                <MarginTypeButton />
              </Box>
            </Grid>
            <Grid item xs={5.2}>
              <Box className="productTour__step4">
                <OrderTypeTabs />
              </Box>
            </Grid>
            <Grid item xs={6.2}>
              <Box className="productTour__step4">
                <SignalTradingSwicth />
              </Box>
            </Grid>
          </Grid>
        </Box>
        <CustomDivider alignment={""} />
        {/* flex:1 so this region takes whatever height remains under the TierCard + header,
            keeping the absolutely-positioned submit button inside the viewport. The scroll area
            reserves ~92px at the bottom for the submit box so fields never hide behind it. */}
        <Box p={1} sx={{ position: "relative", flex: 1, minHeight: 0 }}>
          <Box height={"calc(100% - 92px)"} minHeight={"140px"} overflow={"auto"}>
            <Box sx={{ minHeight: "300px" }}>
              <Grid item xs={12} gap={1} justifyContent={"space-between"} container>
                <QuantityLimitTriggerFieldWrapper />

                <Grid container item justifyContent={"space-between"} gap={1} xs={12}>
                  <TakeProfitStopLoss />
                </Grid>

                <Grid item xs={12}>
                  <LivingMargin />
                </Grid>
              </Grid>
            </Box>
          </Box>
          <LockedOutScreen />
          <div>
            <OrderformSubmit />
          </div>
        </Box>
      </Box>
    </OrderFormNewWrapper>
  );
}
OrderForm.propTypes = {
  isMobile: PropTypes.bool,
  Side: PropTypes.string,
  auxiliaryHelpers: PropTypes.object
};
export default React.memo(OrderForm);
