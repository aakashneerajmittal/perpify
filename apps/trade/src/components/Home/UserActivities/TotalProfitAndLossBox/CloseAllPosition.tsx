import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import PropTypes from "prop-types";
import CustomButton from "@/components/UI/CustomButton/CustomButton";
import CloseAllModal from "@/components/CustomModals/CloseAllModal";
import { DENSITY_WS_SUBSCRIBE_CLOSE_ORDER } from "@/frontend-BL/redux/constants/Constants";
import { closeAllActivePositions } from "@/frontend-api-service/Api";
import { showSnackBar } from "@/frontend-BL/redux/actions/Internal/GlobalErrorHandler.ac";
import { usePostHog } from "posthog-js/react";
import { recordCleverTapEvent } from "@/utils/recordCleverTapEvent";
// import CustomButton from "@/components/UI/CustomButton/CustomButton";
export const CloseAllPosition = () => {
  const postHog = usePostHog();
  const openPositions = useSelector((state: any) => state.positionsDirectory.currentPositions);

  const [closeAllPositionApiResponseStatus, setCloseAllPositionApiResponseStatus] = useState(false);

  const [closeAllPosition, setCloseAllPosition] = useState(false);
  const dispatch = useDispatch<any>();
  const CloseAllPositionButton = () => {
    // PERPIFY testnet: single market (SPX-PERP) → market_close over the account WS closes it.
    setCloseAllPositionApiResponseStatus(true);
    dispatch({ type: "PERPIFY_MARKET_CLOSE", payload: {} });
    setCloseAllPosition(false);
    setCloseAllPositionApiResponseStatus(false);
    dispatch(
      showSnackBar({
        src: "close all position",
        message: "Position close sent",
        type: "success"
      })
    );
  };

  const handleCloseAllPostion = () => {
    postHog.capture("close_all_position_button_click", {
      event_time: new Date().toUTCString()
    });
    if (localStorage.getItem("doNotShowAgainAllPositionCloseModal") !== "true") {
      setCloseAllPosition(true);
    } else {
      CloseAllPositionButton();
    }
  };

  return (
    <>
      <CustomButton
        id="close-allPosition-button"
        loadingTextDisable={true}
        isDisabled={closeAllPositionApiResponseStatus || openPositions.length === 0}
        isloading={closeAllPositionApiResponseStatus}
        onClick={handleCloseAllPostion}
        label={"close All"}
        variant={"closePositionfailed"}
      />
      {closeAllPosition && (
        <CloseAllModal
          close={() => {
            setCloseAllPosition(false);
            setCloseAllPositionApiResponseStatus(false);
          }}
          isOpen={closeAllPosition}
          closeAllPositionApiResponseStatus={closeAllPositionApiResponseStatus}
          positionEntry={CloseAllPositionButton}
        />
      )}
    </>
  );
};
CloseAllPosition.propTypes = {
  isDisable: PropTypes.bool
};
