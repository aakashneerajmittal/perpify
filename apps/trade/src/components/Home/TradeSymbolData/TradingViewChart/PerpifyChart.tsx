/**
 * PerpifyChart — the open-source chart (TradingView Lightweight Charts, Apache-2.0) that
 * replaces the licensed Charting Library for the testnet, brought up to a pro trading feel:
 *
 *   • candles + a volume histogram pinned to the lower band
 *   • two moving averages (MA7 / MA25)
 *   • a timeframe switcher (1m / 5m / 15m / 1h / 1D)
 *   • a crosshair OHLC + volume legend (top-left)
 *   • the Perpify differentiator: an on-chart "dark ahead" marker + amber shading when the model
 *     is pricing the overnight/weekend gap — computed from the same gap model as the engine.
 *
 * Data: seeds a full OHLC history anchored to the first live price (the engine synthesizes
 * testnet candles the same way), then keeps the current bar live from /marketDataStream mark
 * ticks, aggregating into the selected interval.
 *
 * Upgrade path: when TradingView Advanced Charts is approved, swap this for the full
 * charting_library (the guard in TradingViewChart.tsx already prefers it when present).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { BASE_URL } from "@/frontend-api-service/Base";
import { nextDark, gapScaleFor } from "@/frontend-BL/gap/gapModel";

type Bar = { time: number; open: number; high: number; low: number; close: number };

const UP = "#2ebd85";
const DOWN = "#f6465d";
const MA7_COLOR = "#f0b90b";
const MA25_COLOR = "#4f8eff";
const HISTORY_LIMIT = 240;

const INTERVALS: { label: string; sec: number }[] = [
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
  { label: "1D", sec: 86400 },
];

const fmtHrs = (h: number) => {
  if (h <= 0) return "now";
  const d = Math.floor(h / 24);
  const hh = Math.floor(h % 24);
  const mm = Math.floor((h * 60) % 60);
  return d > 0 ? `${d}d ${hh}h` : hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
};

const sma = (bars: Bar[], end: number, p: number): number | null => {
  if (end < p - 1) return null;
  let s = 0;
  for (let i = end - p + 1; i <= end; i++) s += bars[i].close;
  return s / p;
};

export default function PerpifyChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedSymbol = useSelector((s: any) => s?.selectSymbol?.selectedSymbol) || "SPX-PERP";
  const [dark, setDark] = useState(false); // gap elevated → "pricing the dark"
  const [intervalIdx, setIntervalIdx] = useState(0);
  const [legend, setLegend] = useState<{ o: number; h: number; l: number; c: number; v: number; up: boolean } | null>(null);
  const [ndInfo, setNdInfo] = useState<{ h: number; coeff: number; label: string } | null>(null);

  const interval = INTERVALS[intervalIdx];
  const scale = useMemo(() => gapScaleFor(selectedSymbol), [selectedSymbol]);

  // recompute the "next dark" marker from the gap model (cheap; refresh on a slow cadence).
  useEffect(() => {
    const compute = () => {
      try {
        const nd = nextDark(new Date(), "normal", scale);
        if (nd) setNdInfo({ h: nd.opensInHours, coeff: nd.coeffAtDark, label: nd.label });
        else setNdInfo(null);
      } catch {
        setNdInfo(null);
      }
    };
    compute();
    const id = setInterval(compute, 30000);
    return () => clearInterval(id);
  }, [scale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const INTERVAL_SEC = interval.sec;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a82", fontFamily: "DM Mono, monospace" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.08, bottom: 0.24 } },
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
    // volume histogram, pinned to the lower ~20% via its own overlay price scale.
    const volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ma7 = chart.addLineSeries({ color: MA7_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ma25 = chart.addLineSeries({ color: MA25_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    let closed = false;
    const bars: Bar[] = [];
    const vols: number[] = []; // volume per bar, index-aligned with `bars`
    let lastGap = 1;
    let lastMsg = Date.now(); // last mark-stream message time, for the dead-connection watchdog
    let ticksSeen = 0;
    let hasData = false;
    const bucket = (tSec: number) => Math.floor(tSec / INTERVAL_SEC) * INTERVAL_SEC;

    const resize = () => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    window.addEventListener("resize", resize);

    const pushMA = () => {
      const i = bars.length - 1;
      if (i < 0) return;
      const m7 = sma(bars, i, 7);
      const m25 = sma(bars, i, 25);
      if (m7 != null) ma7.update({ time: bars[i].time as any, value: +m7.toFixed(2) });
      if (m25 != null) ma25.update({ time: bars[i].time as any, value: +m25.toFixed(2) });
    };

    // History backfill: seed a full candlestick history anchored to the first live price via a
    // seeded random walk backward, then continue forward from the live mark stream.
    const backfill = (px: number) => {
      const nowB = bucket(Math.floor(Date.now() / 1000));
      bars.length = 0;
      vols.length = 0;
      let close = px;
      let seed = (987654321 ^ Math.floor(px * 100) ^ (INTERVAL_SEC * 2654435761)) >>> 0;
      const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const tmp: { bar: Bar; vol: number }[] = [];
      const vol0 = Math.max(1, Math.round(px * 0.6));
      for (let i = 1; i <= HISTORY_LIMIT; i++) {
        const time = nowB - i * INTERVAL_SEC;
        const drift = (rnd() - 0.5) * px * 0.0016 * Math.sqrt(INTERVAL_SEC / 60);
        const open = close - drift;
        const high = Math.max(open, close) * (1 + rnd() * 0.0009);
        const low = Math.min(open, close) * (1 - rnd() * 0.0009);
        const bar: Bar = { time, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) };
        tmp.push({ bar, vol: Math.round(vol0 * (0.35 + rnd() * 1.3)) });
        close = open;
      }
      tmp.reverse(); // strictly increasing time for lightweight-charts
      for (const t of tmp) {
        bars.push(t.bar);
        vols.push(t.vol);
      }
      const cur: Bar = { time: nowB, open: px, high: px, low: px, close: px };
      bars.push(cur);
      vols.push(0);
      series.setData(bars as any);
      volSeries.setData(bars.map((b, i) => ({ time: b.time as any, value: vols[i], color: b.close >= b.open ? "rgba(46,189,133,0.5)" : "rgba(246,70,93,0.5)" })));
      const m7: { time: any; value: number }[] = [];
      const m25: { time: any; value: number }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const a = sma(bars, i, 7);
        const b = sma(bars, i, 25);
        if (a != null) m7.push({ time: bars[i].time, value: +a.toFixed(2) });
        if (b != null) m25.push({ time: bars[i].time, value: +b.toFixed(2) });
      }
      ma7.setData(m7 as any);
      ma25.setData(m25 as any);
      chart.timeScale().fitContent();
      hasData = true;
    };

    const applyTick = (px: number) => {
      if (!hasData) {
        backfill(px);
        return;
      }
      const t = bucket(Math.floor(Date.now() / 1000));
      const last = bars[bars.length - 1];
      if (!last || t > last.time) {
        const bar: Bar = { time: t, open: last ? last.close : px, high: px, low: px, close: px };
        bars.push(bar);
        vols.push(1);
      } else {
        last.high = Math.max(last.high, px);
        last.low = Math.min(last.low, px);
        last.close = px;
        vols[vols.length - 1] += 1;
      }
      const cur = bars[bars.length - 1];
      series.update(cur as any);
      volSeries.update({ time: cur.time as any, value: vols[vols.length - 1], color: cur.close >= cur.open ? "rgba(46,189,133,0.5)" : "rgba(246,70,93,0.5)" });
      pushMA();
      if (ticksSeen++ < 3) chart.timeScale().fitContent();
    };

    // crosshair legend (top-left OHLC + volume readout).
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        const last = bars[bars.length - 1];
        if (last) setLegend({ o: last.open, h: last.high, l: last.low, c: last.close, v: vols[vols.length - 1] || 0, up: last.close >= last.open });
        return;
      }
      const c: any = param.seriesData.get(series);
      const v: any = param.seriesData.get(volSeries);
      if (c) setLegend({ o: c.open, h: c.high, l: c.low, c: c.close, v: v ? v.value : 0, up: c.close >= c.open });
    });

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
      lastMsg = Date.now();
      ws.onmessage = (ev) => {
        lastMsg = Date.now();
        let m: any;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m?.e !== "markPriceUpdate") return;
        const px = Number(m.p);
        const gap = Number(m.gc);
        if (px > 0) applyTick(px);
        if (Number.isFinite(gap) && Math.abs(gap - lastGap) > 1e-6) {
          lastGap = gap;
          setDark(gap > 1.005);
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    };

    connect();

    // dead-connection watchdog: the mark stream pushes ~1/s, so >20s of silence means the socket
    // went half-open — close it to force a reconnect so the live candle never freezes.
    const heartbeat = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      if (Date.now() - lastMsg > 20000) {
        try {
          ws.close();
        } catch {
          /* reconnect */
        }
        return;
      }
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        /* noop */
      }
    }, 8000);

    return () => {
      closed = true;
      clearInterval(heartbeat);
      window.removeEventListener("resize", resize);
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
      chart.remove();
    };
    // recreate the chart when market OR interval changes — a clean price scale per symbol
    // (SPX ≈ 7,000 vs a stock ≈ 200 can't share an axis) and a clean re-seed per timeframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, intervalIdx]);

  const px = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      {/* timeframe switcher (top-left) */}
      <div style={{ position: "absolute", top: 6, left: 10, display: "flex", gap: 2, zIndex: 3 }}>
        {INTERVALS.map((iv, i) => (
          <button
            key={iv.label}
            onClick={() => setIntervalIdx(i)}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 5,
              padding: "3px 8px",
              fontFamily: "DM Mono, monospace",
              fontSize: 11,
              lineHeight: 1,
              color: i === intervalIdx ? "#04120b" : "#8a8a82",
              background: i === intervalIdx ? "#2ebd85" : "rgba(255,255,255,0.04)",
            }}
          >
            {iv.label}
          </button>
        ))}
      </div>

      {/* OHLC + volume legend (below the timeframe row) */}
      <div style={{ position: "absolute", top: 34, left: 12, fontFamily: "DM Mono, monospace", fontSize: 11, color: "#8a8a82", pointerEvents: "none", display: "flex", gap: 10, alignItems: "center", zIndex: 2 }}>
        <span style={{ color: "#f0ede8", fontWeight: 600 }}>{selectedSymbol}</span>
        {legend && (
          <span style={{ color: legend.up ? UP : DOWN }}>
            O {px(legend.o)} H {px(legend.h)} L {px(legend.l)} C {px(legend.c)}
          </span>
        )}
        <span style={{ color: MA7_COLOR }}>MA7</span>
        <span style={{ color: MA25_COLOR }}>MA25</span>
      </div>

      {/* Perpify differentiator: the on-chart "dark ahead" marker (top-right) */}
      {ndInfo && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 64,
            fontFamily: "DM Mono, monospace",
            fontSize: 11,
            color: dark ? "#ffb454" : "#8a8a82",
            pointerEvents: "none",
            textAlign: "right",
            zIndex: 2,
          }}
        >
          ◗ dark in {fmtHrs(ndInfo.h)} · margin → <span style={{ color: "#ffb454", fontWeight: 700 }}>{ndInfo.coeff.toFixed(2)}×</span>
        </div>
      )}

      {/* amber right-edge wash while the model is actively pricing the gap */}
      {dark && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 56,
            bottom: 26,
            width: "22%",
            pointerEvents: "none",
            background: "linear-gradient(90deg, rgba(255,180,84,0) 0%, rgba(255,180,84,0.09) 100%)",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}
