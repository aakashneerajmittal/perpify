import React, { useContext, useState } from "react";
import { ORDERFORM_CONSTANTS } from "../../../frontend-BL/businessHooks/ORDER_FORM/Constants/Orderform_const";
import ShareIcon from "@/assets/images/ShareIcon.svg";
import ShareIconEnabled from "@/assets/images/ShareIconEnabled.svg";
import CustomButton from "../../UI/CustomButton/CustomButton";
import OrderFormContext from "./OrderFormNewWrapper";
import useOrderFormSubmit from "@/frontend-BL/businessHooks/ORDER_FORM/useOrderFormSubmit";
import { Box, Tooltip, Typography } from "@mui/material";
import CustomDivider from "../../UI/Divider/CustomDivider";
import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";
import { connectWallet } from "@/config/perpifySession";
import { useNavigate } from "react-router-dom";
import OrderConfirmedModal from "../../CustomModals/OrderConfirmedModal";
import GenerateSignalConfirmation from "./GenerateSignalConfirmation";
import { WalletBalanceUsedTooltip } from "@/assets/strings/tooltip.string";
import TextView from "../../UI/TextView/TextView";
import { SymbolPrecisionHelper } from "@/helpers";
import { useSelector } from "react-redux";
import ShareOrderFormModal from "./ShareOrderFormModal";
import { recordCleverTapEvent } from "@/utils/recordCleverTapEvent";

const OrderformSubmit = () => {
  const { isLoggedIn } = useCheckLoginStatus();
  const navigate = useNavigate();
  const [orderConfirm, setOrderConfirm] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const { state, dispatchOrderEvent } = useContext(OrderFormContext);
  const orderformSubmit = useOrderFormSubmit({
    setOrderConfirm,
    setShowGenerateConfirm,
    state,
    dispatchOrderEvent
  });

  const symbol = useSelector((state) => state.selectSymbol.selectedSymbol?.toUpperCase());
  const { setDecimalPrecision } = SymbolPrecisionHelper({ symbol });
  const { side, setShowLoader, createOrderApiCall, hangleSubmitOrderForm, showLoader, isOrderFormSubmitButtonDisable, handleGenerateSignal, handleSubmitSignal } = orderformSubmit;
  const handleShareClick = () => {
    if (isOrderFormSubmitButtonDisable) return;
    setShowShareModal(true);
  };

  const handleLogin = () => {
    // PERPIFY testnet: "Login to Trade" mints a burner wallet in-place (no /auth page).
    // useCheckLoginStatus flips to logged-in, which opens the account WS (SideBar effect),
    // and the engine funds the demo account. No real signup/2FA on testnet.
    try {
      window.gtag?.("event", "Login to Trade");
    } catch {
      /* analytics disabled on testnet */
    }
    connectWallet();
  };

  const handleSignUp = () => {
    // Testnet has no separate signup — same one-click burner wallet as login.
    handleLogin();
  };

  return (
    <>
      <Box
        className="productTour__step7"
        sx={{
          backgroundColor: "background.primary",
          position: "absolute",
          bottom: 0,
          left: 0,
          borderBottomLeftRadius: "8px",
          borderBottomRightRadius: "8px",
          right: 0
        }}
      >
        <CustomDivider />
        {isLoggedIn && (
          <Box p={1}>
            {!state.isSignalTrading ? (
              <>
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
                  title={<TextView text={WalletBalanceUsedTooltip} />}
                >
                  <Box
                    sx={{
                      display: "flex",
                      pb: 1,
                      justifyContent: "space-between"
                    }}
                  >
                    <Typography component={"h6"} variant="Medium_12" color={"text.quaternary"}>
                      {"Wallet Balance Used"}
                    </Typography>
                    <Typography component={"h6"} variant="Medium_12">
                      {setDecimalPrecision(state.costValue, 2)}
                      <Typography ml={0.5} variant="Medium_12" color={"text.regular"}>
                        {"USDT"}
                      </Typography>
                    </Typography>
                  </Box>
                </Tooltip>
                <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                  <CustomButton
                    isDisabled={showLoader || isOrderFormSubmitButtonDisable}
                    isloading={showLoader}
                    type="submit"
                    onClick={hangleSubmitOrderForm}
                    id="orderForm-submit-button"
                    variant={side === "BUY" ? "success" : "failed"}
                    label={side === "BUY" ? ORDERFORM_CONSTANTS.BUY_LONG_LABEL : ORDERFORM_CONSTANTS.SELL_SHORT_LABEL}
                  />

                  <img src={isOrderFormSubmitButtonDisable ? ShareIcon : ShareIconEnabled} onClick={handleShareClick} style={{ cursor: "pointer" }} />
                </Box>
              </>
            ) : (
              <Box>
                <CustomButton
                  isDisabled={showLoader || isOrderFormSubmitButtonDisable}
                  isloading={showLoader}
                  type="submit"
                  onClick={handleSubmitSignal}
                  id="orderForm-submit-button"
                  variant={"success"}
                  label={"Generate Signal"}
                />
              </Box>
            )}
          </Box>
        )}
        {!isLoggedIn && (
          <Box p={2}>
            {" "}
            <CustomButton onClick={() => handleLogin()} label={"Login to Trade"} />
            <Typography mt={1} component={"p"} textAlign={"center"} variant="Medium_12">
              New to Density?
              <Typography
                ml={1}
                variant="Medium_12"
                color={"text.main"}
                sx={{
                  cursor: "pointer",
                  borderBottom: "1px solid",
                  borderColor: "text.main"
                }}
                onClick={() => handleSignUp()}
              >
                Sign Up
              </Typography>
            </Typography>
          </Box>
        )}
        <OrderConfirmedModal
          showLoader={showLoader}
          setShowLoader={setShowLoader}
          createOrderApiCall={createOrderApiCall}
          setOrderConfirm={setOrderConfirm}
          orderDetails={state}
          isOpen={orderConfirm}
        />
        {showGenerateConfirm && (
          <GenerateSignalConfirmation
            IsOpen={showGenerateConfirm}
            setGenerateConfirmModal={setShowGenerateConfirm}
            generateSignal={handleGenerateSignal}
            showLoader={showLoader}
            setShowLoader={setShowLoader}
            orderDetails={state}
          />
        )}

        {showShareModal && <ShareOrderFormModal open={showShareModal} close={() => setShowShareModal(false)} />}
      </Box>
    </>
  );
};
export default React.memo(OrderformSubmit);
