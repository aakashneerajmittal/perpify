import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import PropTypes from "prop-types";
import { Box } from "@mui/material";
import CustomButton from "@/components/UI/CustomButton/CustomButton";
import CloseAllModal from "@/components/CustomModals/CloseAllModal";
import { DENSITY_WS_SUBSCRIBE_CLOSE_ORDER } from "@/frontend-BL/redux/constants/Constants";
import { closeAllActivePositions } from "@/frontend-api-service/Api";
import { showSnackBar } from "@/frontend-BL/redux/actions/Internal/GlobalErrorHandler.ac";
import { perpifyWsSend } from "@/frontend-api-service/perpifyWsBridge";
import { MONO_FAMILY } from "@/assets/Theme/typography";
import { usePostHog } from "posthog-js/react";
import { recordCleverTapEvent } from "@/utils/recordCleverTapEvent";
// import CustomButton from "@/components/UI/CustomButton/CustomButton";
export const CloseAllPosition = () => {
  const postHog = usePostHog();
  const openPositions = useSelector((state: any) => state.positionsDirectory.currentPositions);
  const selectedSymbol = useSelector((state: any) => state?.selectSymbol?.selectedSymbol) || "SPX-PERP";

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

  const handleSimulateGap = () => {
    // DEMO: ask the engine to simulate a severe reopen gap on the selected market →
    // liquidates that position → signed explainer modal. Shows the thesis (dark-period
    // risk) live. If you hold no position in the selected market, the engine falls back
    // to a market you do hold.
    const ok = perpifyWsSend({ type: "demo_gap", symbol: selectedSymbol });
    dispatch(
      showSnackBar({
        src: "demo gap",
        message: ok ? "Simulating a severe reopen gap…" : "Reconnect to simulate",
        type: ok ? "success" : "error"
      })
    );
  };

  return (
    <>
      {openPositions.length > 0 && (
        <Box
          onClick={handleSimulateGap}
          title="Simulate a severe reopen gap (testnet demo) — liquidates under-margined positions with a signed explainer"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            mr: 1,
            px: "12px",
            height: 32,
            borderRadius: "6px",
            cursor: "pointer",
            border: "1px solid rgba(235,182,47,0.45)",
            color: "#EBB62F",
            background: "rgba(235,182,47,0.08)",
            fontFamily: MONO_FAMILY,
            fontSize: 11,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            transition: "background 0.15s",
            // the order-form panel overlaps this footer region — lift above it so the
            // click actually lands on the button (not the panel behind it).
            position: "relative",
            zIndex: 1300,
            "&:hover": { background: "rgba(235,182,47,0.16)" }
          }}
        >
          ⚡ Simulate gap
        </Box>
      )}
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
