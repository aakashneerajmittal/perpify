import React from "react";
import PropTypes from "prop-types";

import Congratulations from "../../assets/images/Congratulations.svg";
import { Box, Typography, Grid, Button } from "@mui/material";
import CustomModal from "./newModal/CustomModal";

const CongratulationsModal = ({ isOpen, close, showNextModal }) => {
  return (
    <CustomModal isOpen={isOpen} close={close}>
      <Box
        component="form"
        noValidate
        autoComplete="off"
        textAlign="center"
        sx={{
          maxWidth: "100%",
          margin: 0
        }}
      >
        <img style={{ width: "100%", height: "170px" }} src={Congratulations} />
        <Typography>Congratulations!</Typography>
      </Box>
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
          onClick={close}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          sx={{
            backgroundColor: "#fff",
            color: "#000"
          }}
          onClick={() => showNextModal()}
        >
          Trade Now
        </Button>
      </Grid>
    </CustomModal>
  );
};

CongratulationsModal.propTypes = {
  isOpen: PropTypes.bool,
  close: PropTypes.func,
  showNextModal: PropTypes.func
};
export default CongratulationsModal;
