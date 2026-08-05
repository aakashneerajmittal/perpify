// Name of the component
export const MuiButton = {
  styleOverrides: {
    // Name of the slot
    root: {
      width: "100%",
      fontSize: "14px",
      borderRadius: "4px",
      padding: "8px 16px",
      textTransform: "capitalize",
      color: "white",
      "&:hover": {
        color: "white",
        backgroundColor: "none"
      },
      "&.Mui-disabled": {
        color: "#1F1F24",
        backgroundColor: "#ffffff5e"
      }
    }
  },
  variants: [
    {
      props: { variant: "primary" },
      style: {
        color: "black",
        backgroundColor: "#fff",
        "&:hover": { color: "black", backgroundColor: "#fff" }
      }
    },
    {
      props: { variant: "DensityMain" },
      style: {
        color: "#4F8EFF",
        border: "0.1px solid #4F8EFF",
        "&:hover": {
          color: "#4F8EFF",
          backgroundColor: "rgb(255 255 255 / 8%);"
        }
      }
    },
    {
      props: { variant: "DensityMainFill" },
      style: ({ theme }: { theme: any }) => ({
        color: "black",
        backgroundColor: "#4F8EFF",
        "&:hover": { color: "black", backgroundColor: "#4F8EFF" }
      })
    },
    {
      props: { variant: "main" },
      style: {
        color: "#fff",
        border: "1px solid #fff",
        "&:hover": { color: "#fff", backgroundColor: "rgb(255 255 255 / 8%);" }
      }
    },
    {
      props: { variant: "secondary" },
      style: {
        border: "0.5px solid #B1B1BA",
        "&:hover": { color: "#fff", backgroundColor: "rgb(255 255 255 / 8%);" }
      }
    },
    {
      props: { variant: "success" },
      style: ({ theme }: { theme: any }) => ({
        backgroundColor: `${theme.palette.background.success.primary}`,
        color: "#fff",
        "&:hover": { color: "#fff", backgroundColor: "#219165" }
      })
    },

    {
      props: { variant: "failed" },
      style: ({ theme }: { theme: any }) => ({
        backgroundColor: `${theme.palette.background.error.primary}`,
        color: "#fff",
        "&:hover": { color: "#FFF", backgroundColor: "#c34c4c" }
      })
    },
    {
      props: { variant: "closePositionfailed" },
      style: {
        borderRadius: "4px",
        border: "1px solid #FF6554",
        color: "#FF6554",
        "&.Mui-disabled": {
          border: "none"
        },
        "&:hover": {
          color: "#FF6554",
          backgroundColor: "rgb(255 255 255 / 8%);"
        }
      }
    },
    {
      props: { variant: "closePositionSuccess" },
      style: {
        borderRadius: "4px",
        border: "1px solid #29B57E",
        color: "#29B57E",
        "&.Mui-disabled": {
          border: "none"
        },
        "&:hover": {
          color: "#29B57E",
          backgroundColor: "rgb(255 255 255 / 8%);"
        }
      }
    }
  ]
};
