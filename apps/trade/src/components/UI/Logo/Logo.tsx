import React from "react";
import PropTypes from "prop-types";
import { Box } from "@mui/material";
import DENSITY_LOGO from "../../../assets/images/logo/Logo.svg";

import { useNavigate } from "react-router-dom";
import DensityLogoWithName from "ASSETS/images/logo/LogoWithText.svg";
const Logo = ({ withName, style }: { withName: boolean; style: any }) => {
  const navigate = useNavigate();
  return (
    <>
      {!withName && (
        <Box
          onClick={() => navigate("/")}
          sx={{
            height: "50px",
            cursor: "pointer"
          }}
        >
          <Box sx={{ width: "100%", height: "100%", ...style }} component={"img"} src={DENSITY_LOGO} alt="density" />
        </Box>
      )}
      {withName && <Box component={"img"} onClick={() => navigate("/")} sx={{ cursor: "pointer", ...style }} src={DensityLogoWithName} alt="density" />}
    </>
  );
};
Logo.propTypes = {
  withName: PropTypes.bool,
  display: PropTypes.object
};

export default Logo;
