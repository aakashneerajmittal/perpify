import React from "react";
import PropTypes from "prop-types";
import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";

/**
 * PERPIFY brand mark. Rendered inline (no asset file) so it always matches the brand accent
 * (#4F8EFF, from the deck). `withName={false}` → the compact "P" tile (header rail);
 * `withName` → the full PERPIFY wordmark.
 */
const Logo = ({ withName, style }: { withName: boolean; style: any }) => {
  const navigate = useNavigate();

  if (withName) {
    return (
      <Box
        component="span"
        onClick={() => navigate("/")}
        sx={{
          cursor: "pointer",
          color: "#4F8EFF",
          fontFamily: "Inter, -apple-system, sans-serif",
          fontWeight: 900,
          fontSize: "22px",
          letterSpacing: "-0.02em",
          userSelect: "none",
          ...style
        }}
      >
        PERPIFY
      </Box>
    );
  }

  return (
    <Box
      onClick={() => navigate("/")}
      sx={{
        width: "40px",
        height: "40px",
        borderRadius: "10px",
        background: "linear-gradient(135deg, #4F8EFF 0%, #2E6BE0 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 2px 10px rgba(79,142,255,0.35)",
        ...style
      }}
    >
      <Box
        component="span"
        sx={{
          color: "#fff",
          fontFamily: "Inter, -apple-system, sans-serif",
          fontWeight: 800,
          fontSize: "22px",
          lineHeight: 1,
          userSelect: "none"
        }}
      >
        P
      </Box>
    </Box>
  );
};

Logo.propTypes = {
  withName: PropTypes.bool,
  display: PropTypes.object
};

export default Logo;
