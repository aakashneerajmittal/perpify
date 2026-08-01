/**
 * LiquidationExplainerModal — when the engine liquidates a position it pushes a
 * SIGNED explainer (Playbook §2.5); this modal shows *why*, replayably: equity fell
 * below maintenance margin, with the exact risk inputs (behavioral tier, gap
 * coefficient, oracle confidence) and a proof hash that ties inputs → model → the
 * decision. This is the "explained liquidation" the deck promises.
 */
import React from "react";
import { Modal, Box } from "@mui/material";
import { useSelector, useDispatch } from "react-redux";
import { MONO_FAMILY, SERIF_FAMILY } from "@/assets/Theme/typography";

const RED = "#FF5555";
const TEXT = "#F0EDE8";
const MUTED = "#888880";
const DIM = "#55554F";

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number, d = 2) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const shortHash = (h?: string) => (h && h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h || "—");

function Row({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", py: "6px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11.5, color: MUTED }}>{label}</Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        {hint && <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, color: RED, letterSpacing: "0.06em" }}>{hint}</Box>}
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 12.5, color: color || TEXT }}>{value}</Box>
      </Box>
    </Box>
  );
}

export default function LiquidationExplainerModal() {
  const ex = useSelector((s: any) => s.liquidation?.latest);
  const dispatch = useDispatch();
  const close = () => dispatch({ type: "DISMISS_LIQUIDATION_EXPLAINER" });

  if (!ex) return null;
  const sideLabel = String(ex.side).toLowerCase() === "buy" ? "LONG" : "SHORT";

  return (
    <Modal open onClose={close} sx={{ display: "grid", placeItems: "center" }}>
      <Box
        sx={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          background: "#0F0F0F",
          border: `1px solid ${RED}44`,
          borderRadius: "16px",
          p: "24px",
          outline: "none",
          boxShadow: `0 24px 64px rgba(0,0,0,0.6)`
        }}
      >
        {/* header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: "4px" }}>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 10, letterSpacing: "0.16em", color: RED, textTransform: "uppercase" }}>
            Perpify · Signed liquidation
          </Box>
          <Box onClick={close} sx={{ cursor: "pointer", color: MUTED, fontFamily: MONO_FAMILY, fontSize: 16, "&:hover": { color: TEXT } }}>
            ✕
          </Box>
        </Box>
        <Box sx={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", color: TEXT, mb: "4px" }}>
          Position liquidated
        </Box>
        <Box sx={{ fontFamily: SERIF_FAMILY, fontStyle: "italic", fontSize: 15, color: MUTED, mb: "18px", lineHeight: 1.4 }}>
          Your {sideLabel} {num(ex.qty, 2)} {ex.market} closed at{" "}
          <span style={{ color: TEXT, fontFamily: MONO_FAMILY, fontStyle: "normal" }}>{num(ex.avgFillPx, 2)}</span>. Here is exactly why —
          signed and replayable.
        </Box>

        {/* the trigger */}
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.16em", color: DIM, textTransform: "uppercase", mb: "6px" }}>
          Trigger
        </Box>
        <Row label="Equity at trigger" value={usd(ex.equity)} color={RED} />
        <Row label="Maintenance margin" value={usd(ex.mmRequired)} hint="breached" />

        {/* the inputs */}
        <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.16em", color: DIM, textTransform: "uppercase", m: "16px 0 6px" }}>
          Risk inputs at liquidation
        </Box>
        <Row label="Behavioral tier" value={String(ex.tier)} color="#4F8EFF" />
        <Row label="Gap coefficient" value={`${num(ex.gapCoefficient, 2)}×`} />
        <Row label="Oracle confidence" value={num(ex.confidence, 2)} />
        {ex.queueRank != null && <Row label="Sequenced rank" value={`#${ex.queueRank}`} />}

        {/* proof */}
        <Box sx={{ mt: "16px", p: "12px", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", background: "#0A0A0A" }}>
          <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 9.5, letterSpacing: "0.14em", color: DIM, textTransform: "uppercase", mb: "6px" }}>
            Proof · inputs → model → decision
          </Box>
          <Row label="Model" value={`${ex.modelVersion || "tier"} · ${ex.gapModelVersion || "gap"}`} />
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", pt: "6px" }}>
            <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 11.5, color: MUTED }}>Hash</Box>
            <Box sx={{ fontFamily: MONO_FAMILY, fontSize: 12, color: TEXT }}>{shortHash(ex.proofHash)}</Box>
          </Box>
        </Box>

        <Box
          onClick={close}
          sx={{
            mt: "18px",
            p: "11px",
            borderRadius: "9px",
            textAlign: "center",
            cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "#151515",
            fontFamily: "'Syne', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            color: TEXT,
            "&:hover": { background: "#1B1B1B" }
          }}
        >
          Dismiss
        </Box>
      </Box>
    </Modal>
  );
}
