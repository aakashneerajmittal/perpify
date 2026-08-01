import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import { Logo } from "@/components/UI/Logo";
import { useNavigate } from "react-router-dom";
import NavigationBar from "./NavigationBar";

export default function Topbar() {
  const [state, setState] = React.useState(false);

  const navigate = useNavigate();
  return (
    <Box sx={{ flexGrow: 1, display: { xs: "block", md: "none" } }}>
      <AppBar position="static">
        <Toolbar
          sx={{
            justifyContent: "space-between",
            minHeight: "50px !important",
            alignItems: "stretch",
            backgroundColor: "background.primary"
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", py: 0.5 }}>
            <Logo withName={false} style={{ width: "34px", height: "34px" }} />
          </Box>

          <IconButton size="small" edge="start" color="inherit" aria-label="menu">
            <MenuIcon onClick={() => setState(true)} />
          </IconButton>
        </Toolbar>
      </AppBar>
      <NavigationBar state={state} setState={setState} />
    </Box>
  );
}
