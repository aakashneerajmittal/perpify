import React, { useEffect } from "react";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import PropTypes from "prop-types";
import { styled } from "@mui/material/styles";
import { ORDERFORM_CONSTANTS } from "BL/businessHooks/ORDER_FORM/Constants/Orderform_const";
import { Box } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
const BuySellToggle = ({ Side, showOrderForm, setShowOrderForm }: { Side: string; showOrderForm: any; setShowOrderForm: () => void }) => {
  useEffect(() => {
    if (Side) {
      SideChange({ target: { value: Side } });
    }
  }, [Side]);

  const SideChange = (event: { target: any }) => {
    setShowOrderForm({ expand: false, side: event.target.value });
  };

  const StyledToggleButtonGroup = styled(ToggleButtonGroup)(({ theme }) => ({
    "& .MuiToggleButtonGroup-grouped": {
      margin: theme.spacing(0.5),
      border: 0,
      "&.Mui-disabled": {
        border: 0
      },
      "&:not(:first-of-type)": {
        borderRadius: theme.shape.borderRadius
      },
      "&:first-of-type": {
        borderRadius: theme.shape.borderRadius
      }
    }
  }));
  return (
    <Box sx={{ backgroundColor: "neutral.grey2" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          height: "35px",
          minWidth: "300px"
        }}
      >
        <StyledToggleButtonGroup
          size="small"
          exclusive
          id="orderForm-buySellToggle-button"
          onClick={SideChange}
          value={showOrderForm.side}
          sx={{
            width: "100%",
            backgroundColor: "background.default"
          }}
          aria-label="text alignment"
        >
          <ToggleButton id="buyLong-btn" variant="success" value="BUY" sx={{ width: "50%", textTransform: "capitalize" }}>
            {ORDERFORM_CONSTANTS.BUY_LONG_LABEL}
          </ToggleButton>
          <ToggleButton id="sellSort-btn" variant="failed" value="SELL" sx={{ width: "50%", textTransform: "capitalize" }}>
            {ORDERFORM_CONSTANTS.SELL_SHORT_LABEL}
          </ToggleButton>
        </StyledToggleButtonGroup>
        {!showOrderForm.expand && (
          <ExpandMoreIcon
            onClick={() => {
              setShowOrderForm({
                expand: !showOrderForm.expand,
                side: showOrderForm.side
              });
              localStorage.setItem("showOrderForm", true);
            }}
            sx={{
              cursor: "pointer",
              width: { sm: 24, xs: 20 },
              height: { sm: 24, xs: 20 }
            }}
          />
        )}
        {showOrderForm.expand && (
          <ExpandLessIcon
            onClick={() => {
              localStorage.setItem("showOrderForm", false);
              setShowOrderForm({
                expand: !showOrderForm.expand,
                side: showOrderForm.side
              });
            }}
            sx={{
              cursor: "pointer",
              width: { sm: 24, xs: 20 },
              height: { sm: 24, xs: 20 }
            }}
          />
        )}
      </Box>
    </Box>
  );
};

BuySellToggle.propTypes = {
  showOrderForm: PropTypes.object,
  setShowOrderForm: PropTypes.func,
  handleSideChange: PropTypes.func,
  Side: PropTypes.string
};

export default React.memo(BuySellToggle);
