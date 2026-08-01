/* eslint-disable multiline-ternary */
/* eslint-disable react/no-unescaped-entities */
import React, { useState } from "react";
import PropTypes from "prop-types";
import WelcomeModalImg from "../../assets/images/WelcomeModalSvg.svg";
import { Box, Typography, Grid, Button } from "@mui/material";
import CustomModal from "./newModal/CustomModal";

const WelcomeModal = ({ isOpen, close, startProductTour, showPreviousModal }) => {
  const [showContent, setShowContent] = useState(1);
  return (
    <CustomModal
      isOpen={isOpen}
      close={close}
      disableConfirm={true}
      stylesContainer={{
        borderRadius: 0,
        padding: 0,
        border: "none",
        backgroundColor: "#1F1F24"
      }}
    >
      {showContent !== 3 ? (
        <Box
          component="form"
          noValidate
          autoComplete="off"
          sx={{
            maxWidth: "100%",
            margin: "20px"
          }}
        >
          <Typography sx={{ fontSize: "28px", textAlign: "center" }}>{showContent === 1 ? "Welcome!" : "Risk Warning!"}</Typography>
          {showContent === 1 && <img style={{ width: "100%", height: "120px" }} src={WelcomeModalImg} />}
          <Typography sx={{ fontSize: "14px", marginTop: "20px" }}>
            {showContent === 1
              ? " “Welcome to Density, the ultimate destination for trading crypto derivatives! We're thrilled to have you on board and can't wait to help you unleash your full trading potential. With Density, you'll enjoy lightning-fast order execution and real-time market data. Whether you're an experienced trader or just starting out, we're confident that you'll find everything you need to succeed on our platform. So, without further ado, let's dive into the exciting world of crypto derivatives. HAPPY TRADING!”"
              : "The cryptocurrency futures market is associated with a substantial risk and may lead to notable price swings. These fluctuations can occur quickly and unexpectedly, and it is important to note that prior performance is not necessarily indicative of future outcomes. It is important to be aware that in the event of significant price fluctuations, it is possible for all of your margin funds to be liquidated. Therefore, we recommend that you thoroughly evaluate your investment goals, level of familiarity with the market, and risk tolerance prior to engaging in cryptocurrency futures trading."}
          </Typography>
        </Box>
      ) : (
        <Box>
          <Typography sx={{ fontSize: "20px" }}>Product Tour</Typography>
          <Typography sx={{ fontSize: "14px", marginTop: "20px" }}>
            Ready to make your first trade? New to Density do not worry we have got you covered Let us help you to place your first trade.
          </Typography>
        </Box>
      )}

      <Grid
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginTop: "20px"
        }}
      >
        <Button
          variant="outlined"
          sx={{
            margin: "0 20px 0 0",
            color: "#fff",
            border: "1px solid #C2BBBB"
          }}
          onClick={() => (showContent === 1 ? showPreviousModal() : setShowContent(showContent - 1))}
        >
          Previous
        </Button>
        <Button
          type="submit"
          variant="contained"
          sx={{
            backgroundColor: "#fff",
            color: "#000"
          }}
          onClick={() => (showContent === 3 ? startProductTour() : setShowContent(showContent + 1))}
        >
          Next
        </Button>
      </Grid>
    </CustomModal>
  );
};

WelcomeModal.propTypes = {
  isOpen: PropTypes.bool,
  close: PropTypes.func,
  startProductTour: PropTypes.func,
  showPreviousModal: PropTypes.func
};
export default WelcomeModal;
