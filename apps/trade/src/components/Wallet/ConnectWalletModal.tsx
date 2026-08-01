/**
 * ConnectWalletModal — Perpify-branded wallet picker.
 * Real connectors (MetaMask / injected, Coinbase, WalletConnect if configured)
 * come from wagmi; a demo-wallet fallback logs in a burner so a cold investor link
 * still works with zero setup. Either path lands the address in perpifySession,
 * which triggers the existing engine login + $100k testnet funding.
 */
import React, { useMemo } from "react";
import { Modal, Box } from "@mui/material";
import { useConnect } from "wagmi";
import { connectWallet as connectDemoWallet } from "@/config/perpifySession";
import { MONO_FAMILY, SERIF_FAMILY } from "@/assets/Theme/typography";

const BLUE = "#4F8EFF";
const TEXT = "#F0EDE8";
const MUTED = "#888880";

function WalletGlyph({ icon, name }: { icon?: string; name: string }) {
  if (icon) {
    return <img src={icon} alt="" width={26} height={26} style={{ borderRadius: 6, display: "block" }} />;
  }
  // generic wallet glyph
  return (
    <Box
      sx={{
        width: 26,
        height: 26,
        borderRadius: "6px",
        display: "grid",
        placeItems: "center",
        background: "rgba(79,142,255,0.12)",
        color: BLUE,
        fontFamily: MONO_FAMILY,
        fontSize: 12
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </Box>
  );
}

export default function ConnectWalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();

  // Dedupe connectors by display name (EIP-6963 discovery + explicit injected can overlap).
  const list = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((c) => {
      const key = (c.name || c.id || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectors]);

  const handleConnect = (connector: (typeof connectors)[number]) => {
    connect(
      { connector },
      {
        onSuccess: () => onClose(),
        onError: () => {
          /* user rejected / no provider — keep modal open */
        }
      }
    );
  };

  const handleDemo = () => {
    connectDemoWallet(); // mints burner, broadcasts auth → engine login
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} sx={{ display: "grid", placeItems: "center" }}>
      <Box
        sx={{
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          background: "#0F0F0F",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          p: "24px",
          outline: "none",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)"
        }}
      >
        {/* header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: "4px" }}>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 10, letterSpacing: "0.18em", color: "#55554F", textTransform: "uppercase" }}>
            Perpify · Testnet
          </Box>
          <Box
            onClick={onClose}
            sx={{ cursor: "pointer", color: MUTED, fontFamily: MONO_FAMILY, fontSize: 16, lineHeight: 1, "&:hover": { color: TEXT } }}
          >
            ✕
          </Box>
        </Box>
        <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", color: TEXT, mb: "2px" }}>
          Connect wallet
        </Box>
        <Box sx={{ fontFamily: SERIF_FAMILY, fontStyle: "italic", fontSize: 15, color: MUTED, mb: "20px" }}>
          Trade 24/7 S&amp;P 500 perpetuals, AI-priced.
        </Box>

        {/* real connectors */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {list.map((connector) => (
            <Box
              key={connector.uid}
              onClick={() => !isPending && handleConnect(connector)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                p: "12px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.07)",
                background: "#151515",
                cursor: isPending ? "wait" : "pointer",
                transition: "border-color 0.15s, background 0.15s",
                "&:hover": { borderColor: "rgba(79,142,255,0.4)", background: "#181818" }
              }}
            >
              <WalletGlyph icon={(connector as any).icon} name={connector.name} />
              <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 15, color: TEXT }}>{connector.name}</Box>
            </Box>
          ))}
          {list.length === 0 && (
            <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 12, color: MUTED, p: "8px 2px", lineHeight: 1.6 }}>
              No browser wallet detected. Install MetaMask, or explore instantly with a demo wallet below.
            </Box>
          )}
        </Box>

        {/* divider */}
        <Box sx={{ display: "flex", alignItems: "center", gap: "12px", my: "18px" }}>
          <Box sx={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9, letterSpacing: "0.18em", color: "#55554F", textTransform: "uppercase" }}>or</Box>
          <Box sx={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
        </Box>

        {/* demo fallback */}
        <Box
          onClick={handleDemo}
          sx={{
            p: "12px 14px",
            borderRadius: "10px",
            border: `1px solid rgba(79,142,255,0.4)`,
            background: "rgba(79,142,255,0.08)",
            cursor: "pointer",
            textAlign: "center",
            transition: "background 0.15s",
            "&:hover": { background: "rgba(79,142,255,0.16)" }
          }}
        >
          <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: BLUE }}>Continue with a demo wallet</Box>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11, color: MUTED, mt: "3px" }}>Instant · funded with $100,000 testnet USDC</Box>
        </Box>

        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 10, color: "#55554F", textAlign: "center", mt: "16px", lineHeight: 1.6 }}>
          Testnet · play-money only · no real funds at risk
        </Box>
      </Box>
    </Modal>
  );
}
