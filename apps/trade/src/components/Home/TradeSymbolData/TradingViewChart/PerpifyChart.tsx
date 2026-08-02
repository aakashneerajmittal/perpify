/**
 * PerpifyChart — the open-source chart (TradingView Lightweight Charts, Apache-2.0) that
 * replaces the licensed Charting Library for the testnet. It connects directly to the
 * Perpify engine's /marketDataStream and plots the live SPX-PERP mark price, tinting amber
 * when the gap coefficient is elevated ("pricing the dark"). No application, no license fee.
 *
 * Upgrade path: when TradingView Advanced Charts is approved, swap this back for the full
 * charting_library (the guard in TradingViewChart.tsx already prefers it when present).
 */
import React, { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { createChart, ColorType, LineStyle } from "lightweight-charts";
import { BASE_URL } from "@/frontend-api-service/Base";

export default function PerpifyChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedSymbol = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a82", fontFamily: "DM Mono, monospace" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: true },
      crosshair: { horzLine: { labelBackgroundColor: "#4f8eff" }, vertLine: { labelBackgroundColor: "#4f8eff" } },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    const series = chart.addAreaSeries({
      lineColor: "#4f8eff",
      topColor: "rgba(79,142,255,0.20)",
      bottomColor: "rgba(79,142,255,0.0)",
      lineWidth: 2,
      priceLineStyle: LineStyle.Dashed,
    });

    const points = new Map<number, number>(); // second -> last price (dedupe by time)
    let lastGap = 1;

    const resize = () => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    window.addEventListener("resize", resize);

    // engine market-data stream (repointed in Base/index.js → ws://<engine>/marketDataStream)
    let closed = false;
    const connect = () => {
      const base = BASE_URL().binanceWsBase.replace(/\/marketDataStream.*$/, "");
      const url = `${base}/marketDataStream?symbol=${encodeURIComponent(selectedSymbol)}`; // the selected market's tape
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        return;
      }
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m?.e !== "markPriceUpdate") return;
        const px = Number(m.p);
        const gap = Number(m.gc);
        if (!(px > 0)) return;
        const t = Math.floor(Date.now() / 1000);
        points.set(t, px);
        series.update({ time: t as any, value: px });
        if (Number.isFinite(gap) && Math.abs(gap - lastGap) > 1e-6) {
          lastGap = gap;
          const raised = gap > 1.005;
          series.applyOptions({
            lineColor: raised ? "#ffb454" : "#4f8eff",
            topColor: raised ? "rgba(255,180,84,0.20)" : "rgba(79,142,255,0.20)",
            bottomColor: raised ? "rgba(255,180,84,0.0)" : "rgba(79,142,255,0.0)",
          });
        }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    };
    connect();

    return () => {
      closed = true;
      window.removeEventListener("resize", resize);
      try { wsRef.current?.close(); } catch (e) {}
      chart.remove();
    };
    // recreate the chart (and its price scale) when the market changes — SPX ≈ 6,000 and a
    // stock ≈ 200 can't share an axis, so a clean chart per symbol is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      <div style={{ position: "absolute", top: 8, left: 12, fontFamily: "DM Mono, monospace", fontSize: 11, color: "#55554e", pointerEvents: "none" }}>
        {selectedSymbol} · live mark · Perpify
      </div>
    </div>
  );
}
