/* eslint-disable no-unused-vars */
import React from "react";
import PropTypes from "prop-types";
import BasicTextFields from "@/components/UI/CustomInput/BasicTextFields";
import { InputAdornment } from "@mui/material";
import TextView from "@/components/UI/TextView/TextView";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const LimitPriceField = ({ quantityFieldHook }: { quantityFieldHook: any }) => {
  const { limitPrice, limitPriceError, handleLimitPriceChange, handleLastPrice } = quantityFieldHook;
  return (
    <>
      <BasicTextFields
        id="limit-price-sl"
        value={limitPrice}
        type="number"
        placeholder={"0.00"}
        onChange={handleLimitPriceChange}
        label={"Limit Price"}
        inputProps={{ style: { fontFamily: MONO_FAMILY } }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <TextView text={"Last"} onClick={() => handleLastPrice("LIMIT")} component="p" style={{ cursor: "pointer" }} variant="Bold_12" />
            </InputAdornment>
          )
        }}
      />
      <TextView text={limitPriceError} variant="Regular_11" color={"text.error"} />
    </>
  );
};

LimitPriceField.propTypes = { quantityFieldHook: PropTypes.object };

export default LimitPriceField;
