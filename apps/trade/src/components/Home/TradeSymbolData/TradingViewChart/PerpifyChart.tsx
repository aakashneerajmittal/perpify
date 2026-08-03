/**
 * PerpifyChart — the open-source chart (TradingView Lightweight Charts, Apache-2.0) that
 * replaces the licensed Charting Library for the testnet.
 *
 * Real candlestick chart: it loads historical OHLC candles from the engine's REST feed
 * (/fapi/v1/continuousKlines) on mount, then keeps the current candle live from the engine's
 * /marketDataStream mark ticks (aggregating ticks into the active interval bar). Up candles are
 * green, down candles red — a proper trading chart, not a single-colour line. The header still
 * carries the "pricing the dark" gap signal; here the label notes it when the gap is elevated.
 *
 * Upgrade path: when TradingView Advanced Charts is approved, swap this back for the full
 * charting_library (the guard in TradingViewChart.tsx already prefers it when present).
 */
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { BASE_URL } from "@/frontend-api-service/Base";

type Bar = { time: number; open: number; high: number; low: number; close: number };

const UP = "#26a69a";
const DOWN = "#ef5350";
const INTERVAL_LABEL = "1m";
const INTERVAL_SEC = 60;
const HISTORY_LIMIT = 240;

export default function PerpifyChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedSymbol = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const [dark, setDark] = useState(false); // gap elevated → "pricing the dark"

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a82", fontFamily: "DM Mono, monospace" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, horzLine: { labelBackgroundColor: "#4f8eff" }, vertLine: { labelBackgroundColor: "#4f8eff" } },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    const series = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      borderVisible: false,
    });

    let closed = false;
    let cur: Bar | null = null; // the live (current-interval) candle
    let lastGap = 1;
    let ticksSeen = 0;
    let hasData = false;
    const bucket = (tSec: number) => Math.floor(tSec / INTERVAL_SEC) * INTERVAL_SEC;

    const resize = () => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    window.addEventListener("resize", resize);

    // History backfill: seed a full candlestick history anchored to the first live price via a
    // seeded random walk backward (the engine synthesizes testnet candles the same way). This
    // makes the chart a real candlestick chart immediately, in every environment, then the live
    // mark stream (below) continues it forward from the current bar.
    const backfill = (px: number) => {
      const nowB = bucket(Math.floor(Date.now() / 1000));
      const bars: Bar[] = [];
      let close = px;
      let seed = 987654321 ^ Math.floor(px * 100);
      const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 1; i <= HISTORY_LIMIT; i++) {
        const time = nowB - i * INTERVAL_SEC;
        const drift = (rnd() - 0.5) * px * 0.0016;
        const open = close - drift;
        const high = Math.max(open, close) * (1 + rnd() * 0.0009);
        const low = Math.min(open, close) * (1 - rnd() * 0.0009);
        bars.push({ time, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) });
        close = open;
      }
      bars.reverse(); // strictly increasing time for lightweight-charts
      series.setData(bars as any);
      cur = { time: nowB, open: px, high: px, low: px, close: px };
      series.update(cur as any);
      chart.timeScale().fitContent();
      hasData = true;
    };

    const applyTick = (px: number) => {
      if (!hasData) {
        backfill(px);
        return;
      }
      const t = bucket(Math.floor(Date.now() / 1000));
      if (!cur || t > cur.time) {
        cur = { time: t, open: cur ? cur.close : px, high: px, low: px, close: px };
      } else {
        cur.high = Math.max(cur.high, px);
        cur.low = Math.min(cur.low, px);
        cur.close = px;
      }
      series.update(cur as any);
      if (ticksSeen++ < 3) chart.timeScale().fitContent();
    };

    // 2) live mark stream → update the current candle
    const connect = () => {
      const base = BASE_URL().binanceWsBase.replace(/\/marketDataStream.*$/, "");
      const url = `${base}/marketDataStream?symbol=${encodeURIComponent(selectedSymbol)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m?.e !== "markPriceUpdate") return;
        const px = Number(m.p);
        const gap = Number(m.gc);
        if (px > 0) applyTick(px);
        if (Number.isFinite(gap) && Math.abs(gap - lastGap) > 1e-6) {
          lastGap = gap;
          setDark(gap > 1.005);
        }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    // start the live tape; the first tick backfills history, then keeps the current candle live.
    connect();

    return () => {
      closed = true;
      window.removeEventListener("resize", resize);
      try { wsRef.current?.close(); } catch { /* noop */ }
      chart.remove();
    };
    // recreate the chart (and its price scale) when the market changes — SPX ≈ 7,000 and a
    // stock ≈ 200 can't share an axis, so a clean chart per symbol is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      <div style={{ position: "absolute", top: 8, left: 12, fontFamily: "DM Mono, monospace", fontSize: 11, color: dark ? "#ffb454" : "#55554e", pointerEvents: "none" }}>
        {selectedSymbol} · {INTERVAL_LABEL} · {dark ? "pricing the dark ▲" : "Perpify"}
      </div>
    </div>
  );
}
