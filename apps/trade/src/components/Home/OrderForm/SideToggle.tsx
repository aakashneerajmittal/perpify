/**
 * SideToggle — the Buy/Long · Sell/Short selector, now living at the TOP of the order form
 * (the standard perp-venue position, matching a trader's muscle memory) instead of up in the
 * page header. It writes directly to OrderFormContext (UPDATE_SIDE); the submit button, TP/SL
 * and margin readouts already read `state.side` from the same context, so they follow along.
 */
import React, { useContext } from "react";
import { Box } from "@mui/material";
import OrderFormContext from "./OrderFormNewWrapper";

const BUY_ON = "#2ebd85"; // green fill when Long is active
const SELL_ON = "#f6465d"; // red fill when Short is active

const SideToggle: React.FC = () => {
  const { state, dispatchOrderEvent } = useContext(OrderFormContext);
  const side = state?.side || "BUY";
  const set = (s: "BUY" | "SELL") => dispatchOrderEvent({ type: "UPDATE_SIDE", payload: s });

  const cell = (active: boolean, kind: "buy" | "sell") => ({
    flex: 1,
    py: "9px",
    textAlign: "center" as const,
    cursor: "pointer",
    userSelect: "none" as const,
    fontFamily: "Neurial-Medium",
    fontSize: "13.5px",
    fontWeight: 600,
    letterSpacing: "0.2px",
    borderRadius: "6px",
    transition: "background-color .15s, color .15s",
    color: active ? (kind === "buy" ? "#04160c" : "#210307") : "text.regular",
    backgroundColor: active ? (kind === "buy" ? BUY_ON : SELL_ON) : "transparent",
    "&:hover": { color: active ? undefined : "text.main" },
  });

  return (
    <Box
      sx={{
        display: "flex",
        gap: "4px",
        p: "4px",
        m: "8px 8px 0 8px",
        borderRadius: "8px",
        backgroundColor: "background.default",
        border: "1px solid",
        borderColor: "neutral.grey2",
      }}
    >
      <Box id="orderForm-buyLong-toggle" onClick={() => set("BUY")} sx={cell(side === "BUY", "buy")}>
        Buy / Long
      </Box>
      <Box id="orderForm-sellShort-toggle" onClick={() => set("SELL")} sx={cell(side === "SELL", "sell")}>
        Sell / Short
      </Box>
    </Box>
  );
};

export default SideToggle;
