/**
 * ConnectButton — the single wallet control, used in the header (compact pill) and
 * the order form (full-width CTA).
 *   logged out → "Connect Wallet" opens the picker modal
 *   logged in  → address pill (blue dot = real wallet, "DEMO" tag = demo) + disconnect
 */
import React from "react";
import { Box } from "@mui/material";
import { useDisconnect } from "wagmi";
import { useConnectModal } from "./WalletProvider";
import { useCheckLoginStatus } from "@/frontend-BL/services/ThirdPartyServices/SuperTokens/SuperTokenHelper";
import { getWallet, getWalletMode, disconnectWallet } from "@/config/perpifySession";
import { MONO_FAMILY } from "@/assets/Theme/typography";

const BLUE = "#4F8EFF";
const TEXT = "#F0EDE8";
const MUTED = "#888880";

const shorten = (a?: string | null) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");

export default function ConnectButton({ fullWidth = false, label = "Connect Wallet" }: { fullWidth?: boolean; label?: string }) {
  const { open } = useConnectModal();
  const { isLoggedIn } = useCheckLoginStatus();
  const { disconnect } = useDisconnect();

  const address = getWallet();
  const mode = getWalletMode();

  const handleDisconnect = () => {
    try {
      disconnect();
    } catch {
      /* not a wagmi session (demo) */
    }
    disconnectWallet();
  };

  if (!isLoggedIn) {
    return (
      <Box
        onClick={open}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          width: fullWidth ? "100%" : "auto",
          px: fullWidth ? 0 : "18px",
          height: fullWidth ? 44 : 36,
          borderRadius: "8px",
          cursor: "pointer",
          background: BLUE,
          color: "#08131f",
          fontFamily: "'Syne', sans-serif",
          fontWeight: 700,
          fontSize: fullWidth ? 15 : 13,
          letterSpacing: "0.01em",
          transition: "filter 0.15s, transform 0.05s",
          "&:hover": { filter: "brightness(1.08)" },
          "&:active": { transform: "translateY(1px)" }
        }}
      >
        {label}
      </Box>
    );
  }

  // logged-in pill
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", width: fullWidth ? "100%" : "auto", gap: "8px" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flex: fullWidth ? 1 : "unset",
          height: fullWidth ? 44 : 36,
          px: "12px",
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.09)",
          background: "#111111"
        }}
      >
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: mode === "real" ? "#3ECF8E" : BLUE, flexShrink: 0 }} />
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 13, color: TEXT, letterSpacing: "0.02em" }}>{shorten(address)}</Box>
        {mode === "demo" && (
          <Box
            sx={{
              fontFamily: MONO_FAMILY,
              fontSize: 9,
              letterSpacing: "0.12em",
              color: BLUE,
              border: `1px solid rgba(79,142,255,0.35)`,
              borderRadius: "4px",
              px: "5px",
              py: "1px"
            }}
          >
            DEMO
          </Box>
        )}
      </Box>
      <Box
        onClick={handleDisconnect}
        title="Disconnect"
        sx={{
          display: "grid",
          placeItems: "center",
          width: 36,
          height: 36,
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.09)",
          background: "#111111",
          cursor: "pointer",
          color: MUTED,
          transition: "color 0.15s, border-color 0.15s",
          "&:hover": { color: "#FF5555", borderColor: "rgba(255,85,85,0.4)" }
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </Box>
    </Box>
  );
}
