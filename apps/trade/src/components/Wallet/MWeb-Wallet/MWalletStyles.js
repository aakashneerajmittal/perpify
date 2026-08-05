export const StepperStyle = {
  width: "100%",
  justifyContent: "center",
  "& .MuiStepConnector-root": {
    display: "none"
  },
  "& .MuiStep-root": {
    px: 0,
    ml: 1
  },
  "& .MuiSvgIcon-root": {
    fontSize: "20px"
  },
  "& .MuiStepLabel-root": {
    ".MuiStepLabel-label": {
      fontSize: "12px",
      marginTop: "2px"
    },
    ".Mui-completed": {
      color: "#4F8EFF !important", // circle color (ACTIVE)
      ".MuiSvgIcon-root": {
        color: "#4F8EFF !important",
        fontSize: "20px"
      } // circle color (COMPLETED)
    },
    ".Mui-active": {
      color: "#4F8EFF !important", // circle color (ACTIVE)
      "&.MuiSvgIcon-root": {
        color: "#4F8EFF !important",
        fontSize: "20px"
      }
    }
  },
  "& .MuiStepIcon-root": {
    ".Mui-active": {
      color: "#4F8EFF"
    }
  }
};
