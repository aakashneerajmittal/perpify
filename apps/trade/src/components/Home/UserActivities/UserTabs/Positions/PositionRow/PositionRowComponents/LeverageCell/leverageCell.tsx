import React, { memo } from "react";
import PropTypes from "prop-types";
import { Typography } from "@mui/material";
import { useSelector } from "react-redux";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const leverageCell = ({ symbol }: { symbol: string }) => {
  const leverage = useSelector((state: any) => state.positionsDirectory?.leverage).find((item: { sym: string }) => item?.sym?.toUpperCase() === symbol.toUpperCase());
  return (
    <Typography id="position-leverage" color={"text.regular"} variant="medium_12_500" component={"span"} sx={{ fontFamily: MONO_FAMILY }}>
      {`${leverage?.leverage} x`}{" "}
    </Typography>
  );
};

leverageCell.propTypes = { symbol: PropTypes.string };

export default memo(leverageCell);
