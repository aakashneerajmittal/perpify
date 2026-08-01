import React from "react";
import { Box, ToggleButton } from "@mui/material";

import Union from "@/assets/icons/SideBar/Union.svg";
import { useDispatch } from "react-redux";
import { getCurrencyUrl } from "@/helpers/CurrencyLogo";
import PercentageChange from "./PercentageChange";
import TextView from "@/components/UI/TextView/TextView";
import { selectedSymbol } from "@/frontend-BL/redux/actions/Internal/SetSelectedSymbol.ac";
// import { fetchFutureAccountDetails } from "@/frontend-BL/redux/actions/Futures/Futures.ac";

interface WatchListRowRevampedProps {
  symbol: string;
  watchlistID: string;
  handleFavClick: (e: React.MouseEvent<HTMLElement>, symbol: string) => void;
}

export const WatchListRowRevamped: React.FC<WatchListRowRevampedProps> = ({ symbol, handleFavClick }) => {
  const dispatch = useDispatch<any>();
  const onBoxClick = () => {
    // dispatch(fetchFutureAccountDetails());
    dispatch(selectedSymbol(symbol.toLowerCase()));
  };

  const ChipStyles = {
    border: "none",
    borderRadius: "4px",
    padding: "8px 12px 8px 12px",
    backgroundColor: "#0E0E0F",
    height: "32px",
    marginBottom: "5px",
    marginRight: "2.5px",
    width: "220px",
    display: "flex",
    justifyContent: "space-between"
  };

  return (
    <ToggleButton variant="chip" onClick={onBoxClick} sx={ChipStyles}>
      <Box
        sx={{
          display: "flex",
          gap: 0.5,
          alignItems: "center"
        }}
      >
        <Box
          component={"img"}
          src={getCurrencyUrl(symbol.replace("USDT", "").toLowerCase())}
          alt="symbolLogo"
          sx={{
            height: 15,
            width: 15,
            borderRadius: "50%",
            backgroundColor: "white"
          }}
        />
        <TextView text={symbol} color="text.primary" style={{ marginLeft: "7px" }} variant="Medium_12" />
      </Box>
      <PercentageChange symbol={symbol} />

      <img onClick={(e: React.MouseEvent<HTMLElement>) => handleFavClick(e, symbol)} width="8px" src={Union} alt="Fav Icon" />
    </ToggleButton>
  );
};

export default WatchListRowRevamped;
