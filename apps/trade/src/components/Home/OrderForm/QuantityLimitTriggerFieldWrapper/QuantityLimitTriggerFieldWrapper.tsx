import useQuantityFieldhandler from "@/frontend-BL/businessHooks/ORDER_FORM/useQuantityFieldhandler";
import { Grid } from "@mui/material";
import React, { useContext } from "react";
import LimitPriceField from "./LimitPriceField";
import QuantityField from "./SizeField";
import TriggerPriceField from "./TriggerPriceField";
import OrderFormContext from "../OrderFormNewWrapper";
const QuantityLimitTriggerFieldWrapper = () => {
  const { state, dispatchOrderEvent } = useContext(OrderFormContext);
  const quantityFieldHook = useQuantityFieldhandler({
    state,
    dispatchOrderEvent
  });
  // Side is now owned by the in-form <SideToggle/> (writes UPDATE_SIDE directly). The old
  // Side-prop → UPDATE_SIDE bridge here overrode the toggle on every render, so it's removed.

  return (
    <>
      <Grid container gap={1} justifyContent={"space-between"}>
        {(quantityFieldHook.OrderType === 2 || quantityFieldHook.OrderType === 3) && (
          <Grid item xs={[quantityFieldHook.OrderType === 3 ? 5.8 : 12]}>
            <TriggerPriceField quantityFieldHook={quantityFieldHook} />
          </Grid>
        )}
        {(quantityFieldHook.OrderType === 1 || quantityFieldHook.OrderType === 3) && (
          <Grid item xs={[quantityFieldHook.OrderType === 3 ? 5.8 : 12]}>
            <LimitPriceField quantityFieldHook={quantityFieldHook} />
          </Grid>
        )}
      </Grid>
      {!state.isSignalTrading && (
        <Grid item xs={12}>
          <QuantityField quantityFieldHook={quantityFieldHook} />
        </Grid>
      )}
    </>
  );
};

export default QuantityLimitTriggerFieldWrapper;
