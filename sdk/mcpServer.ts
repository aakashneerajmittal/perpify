/**
 * Perpify MCP server — exposes the AI-priced venue to AI agents as tools (Architecture §4.6, M3).
 *
 * A minimal, dependency-light Model Context Protocol server over stdio (newline-delimited
 * JSON-RPC 2.0). Read/simulate tools reuse the engine's own pure risk functions; live tools use
 * the PerpifyClient over the engine WebSocket. An agent can discover markets, read the live gap
 * coefficient, quote a mark, look up a wallet's behavioral tier, simulate margin, open a funded
 * demo account, place market/limit orders, arm TP/SL brackets, read its positions/balance, and
 * close — the whole loop, on-thesis.
 *
 * Run:   PERPIFY_ENGINE_WS=wss://perpify-engine.onrender.com npx tsx sdk/mcpServer.ts
 * Wire it into an MCP client (Claude Desktop / Code / Cowork) as a stdio server (see sdk/README.md).
 */
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { imRequired, mmRequired, collateralRequired } from "../engine/src/margin.js";
import { usd6, toCoeff6 } from "../engine/src/fixed.js";
import { DEFAULT_PARAMS } from "../engine/src/state.js";
import { computeGapReading, gapScaleFor } from "../engine/src/risk/gapCoefficient.js";
import { demoTierForAddress, TIER_MULT } from "../engine/src/risk/tierScore.js";
import { backtestGapScenarios } from "./backtest.js";
import { PerpifyClient, fetchVenueHealth, type Market, type Side } from "./perpifyClient.js";
import type { TierCode } from "../engine/src/types.js";

const ENGINE_WS = process.env.PERPIFY_ENGINE_WS || "wss://perpify-engine.onrender.com";
const ENGINE_HTTP = process.env.PERPIFY_ENGINE_HTTP || ENGINE_WS.replace(/^ws/, "http");
const MARKETS = ["SPX-PERP", "NVDA-PERP", "AAPL-PERP", "MSFT-PERP", "GOOGL-PERP", "AMZN-PERP"];
const num6 = (v: bigint): number => Number(v) / 1e6;

// ---- live helpers (lazy-load `ws` only when a live tool runs) ----

/** One markPriceUpdate from the market-data stream: mark, index, live gap coefficient, confidence. */
async function getMark(market: string): Promise<any> {
  const { default: WebSocket } = await import("ws");
  const base = ENGINE_WS.replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    const w: any = new WebSocket(`${base}/marketDataStream?symbol=${encodeURIComponent(market)}`);
    const to = setTimeout(() => { try { w.close(); } catch { /* noop */ } reject(new Error("mark timeout")); }, 9000);
    w.on("message", (d: any) => {
      let m: any;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m?.e === "markPriceUpdate") {
        clearTimeout(to);
        try { w.close(); } catch { /* noop */ }
        resolve({ market, mark: Number(m.p), index: Number(m.i), gapCoefficient: Number(m.gc), confidence: Number(m.conf), session: m.session });
      }
    });
    w.on("error", (e: any) => { clearTimeout(to); reject(new Error(e?.message || "market data error")); });
  });
}

/** Connect as `wallet` and gather the connect snapshot: tier (SESSION_INFO), balance + positions
 * (ACCOUNT_UPDATE), and resting TP/SL triggers (CONDITIONAL_ORDERS_SNAPSHOT). Any 0x address is
 * auto-funded with 100k testnet USDC on first connect. */
async function snapshotAccount(wallet: string, waitMs = 1600): Promise<any> {
  const { default: WebSocket } = await import("ws");
  const c = new PerpifyClient({ engineWs: ENGINE_WS, wallet, WebSocketImpl: WebSocket });
  let session: any = null;
  let account: any = null;
  let conditional: any[] = [];
  c.onSession((m) => { session = m; });
  c.onAccount((a) => { account = a; });
  c.onConditional((m) => { if (Array.isArray(m?.orders)) conditional = m.orders; });
  await c.connect();
  await new Promise((r) => setTimeout(r, waitMs));
  c.close();
  const bal = (account?.balances || []).find((b: any) => b.asset === "USDC") || account?.balances?.[0] || null;
  const positions = (account?.positions || []).map((p: any) => {
    const signed = Number(p.quantity);
    return {
      symbol: p.symbol,
      side: signed >= 0 ? "long" : "short",
      qty: Math.abs(signed),
      entryPrice: Number(p.entryPrice),
      unrealizedPnl: Number(p.unrealizedProfitAndLoss),
      isolatedMargin: Number(p.isolatedWallet),
    };
  });
  return {
    wallet,
    tier: session?.tier ?? null,
    tierMult: session?.tierMult ?? null,
    maxLeverage: session?.maxLeverage ?? null,
    factors: session?.factors ?? [],
    balanceUsdc: bal ? Number(bal.walletBalance) : null,
    availableUsdc: bal ? Number(bal.crossWalletBalance ?? bal.walletBalance) : null,
    positions,
    openOrders: conditional,
  };
}

// ---- tools ----

const TOOLS = [
  {
    name: "read_venue_health",
    description: "Read the live venue status: service ok, the list of tradable markets, and the engine sequence number.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_quote",
    description: "Live mark price, index price, gap coefficient, oracle confidence and session for a market. Use the mark to size a market order. Markets: " + MARKETS.join(", ") + ".",
    inputSchema: { type: "object", properties: { market: { type: "string", description: "market id, e.g. NVDA-PERP" } }, required: ["market"] },
  },
  {
    name: "query_risk_state",
    description: "Live AI gap coefficient + session for a market — Perpify prices the overnight/weekend dark period INTO margin before the gap, not after. Coefficient >= 1.0.",
    inputSchema: { type: "object", properties: { market: { type: "string", description: "market id, e.g. NVDA-PERP" } }, required: ["market"] },
  },
  {
    name: "lookup_behavioral_tier",
    description: "Return a wallet's behavioral tier (A–E), margin multiplier (tierMult, <1 = discount) and named contributing factors. Discipline posts less margin.",
    inputSchema: { type: "object", properties: { address: { type: "string", description: "0x wallet address" } }, required: ["address"] },
  },
  {
    name: "simulate_margin",
    description: "Compute Perpify's initial/maintenance margin, required collateral and effective leverage for a hypothetical position. IM = notional × baseIM × gapCoefficient × tierMult.",
    inputSchema: {
      type: "object",
      properties: {
        notionalUsd: { type: "number", description: "position notional in USD" },
        tier: { type: "string", enum: ["A", "B", "C", "D", "E"], description: "behavioral tier (default C)" },
        gapCoefficient: { type: "number", description: "gap coefficient (>=1.0); use query_risk_state for the live value" },
      },
      required: ["notionalUsd"],
    },
  },
  {
    name: "backtest_gap",
    description:
      "Backtest a position against Perpify's gap model: initial/maintenance margin, max leverage and liquidation price at the LIVE gap coefficient AND at the full weekend dark-period premium under each volatility regime (calm→crisis). Shows how the dark period reprices your risk BEFORE you trade — required margin rises and max leverage falls through the cycle. Markets: " +
      MARKETS.join(", ") + ".",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "market id, e.g. NVDA-PERP" },
        notionalUsd: { type: "number", description: "position notional in USD" },
        side: { type: "string", enum: ["buy", "sell"], description: "default buy" },
        tier: { type: "string", enum: ["A", "B", "C", "D", "E"], description: "behavioral tier (default C)" },
        entryPrice: { type: "number", description: "entry price (default: live mark)" },
      },
      required: ["market", "notionalUsd"],
    },
  },
  {
    name: "new_demo_wallet",
    description: "Generate a fresh testnet wallet address. It is auto-funded with 100,000 testnet USDC the first time it connects (e.g. via get_account or place_order). No real funds, no signing.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_account",
    description: "Snapshot a wallet: behavioral tier + margin multiplier, USDC balance, open positions (side, qty, entry, uPnL), and resting TP/SL orders. Any 0x address is auto-funded on first use.",
    inputSchema: { type: "object", properties: { wallet: { type: "string", description: "0x wallet address" } }, required: ["wallet"] },
  },
  {
    name: "place_order",
    description: "Place an order on the testnet venue. orderType 'market' fills now against the book at the live mark (price optional — it is fetched and the book is crossed IOC); 'limit' rests at your price (GTC). Returns the order/account updates received right after.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "0x wallet address" },
        symbol: { type: "string", description: "market id, e.g. NVDA-PERP" },
        side: { type: "string", enum: ["buy", "sell"] },
        qty: { type: "number", description: "size in contracts (base units)" },
        orderType: { type: "string", enum: ["market", "limit"], description: "default 'market'" },
        price: { type: "number", description: "required for limit; ignored for market" },
        reduceOnly: { type: "boolean" },
      },
      required: ["wallet", "symbol", "side", "qty"],
    },
  },
  {
    name: "place_bracket",
    description: "Arm reduce-only Take-Profit and/or Stop-Loss triggers that close an existing position when the mark crosses. positionSide is the side you HOLD (long/short); the triggers fire on the opposite side.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "0x wallet address" },
        symbol: { type: "string", description: "market id" },
        positionSide: { type: "string", enum: ["long", "short"], description: "the side you currently hold" },
        qty: { type: "number", description: "size to close (contracts)" },
        takeProfit: { type: "number", description: "take-profit trigger price (optional)" },
        stopLoss: { type: "number", description: "stop-loss trigger price (optional)" },
      },
      required: ["wallet", "symbol", "positionSide", "qty"],
    },
  },
  {
    name: "close_position",
    description: "Market-close a wallet's position via a reduce-only IOC that crosses the book. Give a symbol to close one market, or omit to close every open position.",
    inputSchema: { type: "object", properties: { wallet: { type: "string" }, symbol: { type: "string", description: "market id, or omit for all" } }, required: ["wallet"] },
  },
  {
    name: "cancel_order",
    description: "Cancel a resting order or TP/SL trigger by id. Set isTrigger true for a conditional (TP/SL/stop) order.",
    inputSchema: {
      type: "object",
      properties: { wallet: { type: "string" }, symbol: { type: "string" }, orderId: { type: "string" }, isTrigger: { type: "boolean" } },
      required: ["wallet", "symbol", "orderId"],
    },
  },
];

async function withClient<T>(wallet: string, waitMs: number, fn: (c: PerpifyClient, updates: any[]) => void): Promise<T> {
  const { default: WebSocket } = await import("ws");
  const c = new PerpifyClient({ engineWs: ENGINE_WS, wallet, WebSocketImpl: WebSocket });
  const updates: any[] = [];
  c.onOrder((o) => updates.push({ kind: "order", ...o }));
  c.onAccount((a) => updates.push({ kind: "account", balances: a.balances, positions: a.positions }));
  c.onConditional((m) => updates.push({ kind: "conditional", ...m }));
  await c.connect();
  fn(c, updates);
  await new Promise((r) => setTimeout(r, waitMs));
  c.close();
  return { updates: updates.slice(0, 12) } as any;
}

async function callTool(name: string, args: any): Promise<any> {
  if (name === "read_venue_health") {
    return await fetchVenueHealth(ENGINE_HTTP);
  }
  if (name === "get_quote") {
    return await getMark(String(args.market));
  }
  if (name === "query_risk_state") {
    const market = String(args.market);
    const scale = gapScaleFor(market);
    const g = computeGapReading(new Date(), "normal", scale);
    return { market, gapCoefficient: g.gapCoefficient, session: g.session, hoursDarkRemaining: g.hoursDarkRemaining, darkScale: scale, modelVersion: g.modelVersion };
  }
  if (name === "lookup_behavioral_tier") {
    const t = demoTierForAddress(String(args.address));
    return { address: args.address, tier: t.tier, tierMult: t.tierMult, factors: t.factors, note: "provisional (cold-start, address-derived); the live model (tier-v0.2) refines from observed behavior" };
  }
  if (name === "simulate_margin") {
    const tier: TierCode = (args.tier ?? "C") as TierCode;
    const notional6 = usd6(Number(args.notionalUsd));
    const coeffs = { gapCoeff6: toCoeff6(Number(args.gapCoefficient ?? 1.0)), tierMult6: toCoeff6(TIER_MULT[tier]), tier };
    const col = num6(collateralRequired(notional6, DEFAULT_PARAMS, coeffs));
    return {
      notionalUsd: Number(args.notionalUsd),
      tier,
      gapCoefficient: Number(args.gapCoefficient ?? 1.0),
      initialMargin: num6(imRequired(notional6, DEFAULT_PARAMS, coeffs)),
      maintenanceMargin: num6(mmRequired(notional6, DEFAULT_PARAMS, coeffs)),
      collateralRequired: col,
      maxLeverage: DEFAULT_PARAMS.maxLeverageByTier[tier],
      effectiveLeverage: col > 0 ? Math.round((Number(args.notionalUsd) / col) * 100) / 100 : null,
    };
  }
  if (name === "backtest_gap") {
    const market = String(args.market);
    const tier: TierCode = (args.tier ?? "C") as TierCode;
    const side = (args.side ?? "buy") as "buy" | "sell";
    const notionalUsd = Number(args.notionalUsd);
    // live mark + gap coefficient (entry defaults to the live mark)
    const q = await getMark(market).catch(() => null);
    const entryPx = Number(args.entryPrice) > 0 ? Number(args.entryPrice) : q?.mark;
    if (!entryPx || !(entryPx > 0)) throw new Error("no entry price (pass entryPrice or ensure the market has a live mark)");
    const scenarios = backtestGapScenarios({ market, entryPx, notionalUsd, side, tier, liveGapCoefficient: q?.gapCoefficient });
    return {
      market,
      side,
      tier,
      notionalUsd,
      entryPrice: entryPx,
      liveGapCoefficient: q?.gapCoefficient ?? null,
      session: q?.session ?? null,
      scenarios,
      note: "Perpify prices the overnight/weekend dark period INTO margin before the gap. Higher gap coefficient → more margin, lower max leverage, a farther liquidation buffer.",
    };
  }
  if (name === "new_demo_wallet") {
    const wallet = "0x" + randomBytes(20).toString("hex");
    return { wallet, funding: "100000 testnet USDC on first connect", note: "call get_account or place_order with this wallet to activate it" };
  }
  if (name === "get_account") {
    return await snapshotAccount(String(args.wallet));
  }
  if (name === "place_order") {
    const symbol = args.symbol as Market;
    const side = args.side as Side;
    const orderType = (args.orderType ?? "market") as "market" | "limit";
    let price = Number(args.price);
    let tif: "GTC" | "IOC" = "GTC";
    if (orderType === "market") {
      const q = await getMark(symbol);
      if (!(q.mark > 0)) throw new Error("no live mark for " + symbol);
      price = side === "buy" ? q.mark * 1.05 : q.mark * 0.95; // cross the book (5% slippage cap)
      tif = "IOC";
    } else if (!(price > 0)) {
      throw new Error("limit order needs a price");
    }
    const res = await withClient<any>(String(args.wallet), 1600, (c) => {
      c.placeOrder({ symbol, side, qty: Number(args.qty), price: Number(price.toFixed(2)), tif, reduceOnly: !!args.reduceOnly });
    });
    return { placed: { symbol, side, qty: Number(args.qty), orderType, price: orderType === "limit" ? Number(price.toFixed(2)) : "market" }, ...res };
  }
  if (name === "place_bracket") {
    const symbol = args.symbol as Market;
    const closeSide: Side = args.positionSide === "long" ? "sell" : "buy";
    const q = await getMark(symbol);
    const qty = Number(args.qty);
    const armed: string[] = [];
    const res = await withClient<any>(String(args.wallet), 1600, (c) => {
      if (Number(args.takeProfit) > 0) {
        c.placeTrigger({ symbol, side: closeSide, qty, triggerPx: Number(args.takeProfit), triggerAbove: Number(args.takeProfit) >= q.mark, reduceOnly: true });
        armed.push("takeProfit@" + args.takeProfit);
      }
      if (Number(args.stopLoss) > 0) {
        c.placeTrigger({ symbol, side: closeSide, qty, triggerPx: Number(args.stopLoss), triggerAbove: Number(args.stopLoss) >= q.mark, reduceOnly: true });
        armed.push("stopLoss@" + args.stopLoss);
      }
    });
    return { armed, closeSide, mark: q.mark, ...res };
  }
  if (name === "close_position") {
    const res = await withClient<any>(String(args.wallet), 1600, (c) => {
      c.marketClose(args.symbol ? (args.symbol as Market) : undefined);
    });
    return { closed: args.symbol ?? "all", ...res };
  }
  if (name === "cancel_order") {
    const res = await withClient<any>(String(args.wallet), 1200, (c) => {
      if (args.isTrigger) c.cancelTrigger(args.symbol as Market, String(args.orderId));
      else c.cancel(args.symbol as Market, String(args.orderId));
    });
    return { cancelled: args.orderId, ...res };
  }
  throw new Error(`unknown tool ${name}`);
}

// ---- minimal MCP stdio JSON-RPC ----
const out = (msg: any) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const t = line.trim();
  if (!t) return;
  let req: any;
  try {
    req = JSON.parse(t);
  } catch {
    return;
  }
  const reply = (result: any) => out({ jsonrpc: "2.0", id: req.id, result });
  const fail = (message: string) => out({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } });
  try {
    if (req.method === "initialize") {
      return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "perpify", version: "0.2.0" } });
    }
    if (req.method?.startsWith("notifications/")) return; // no id, no reply
    if (req.method === "tools/list") return reply({ tools: TOOLS });
    if (req.method === "tools/call") {
      const res = await callTool(req.params.name, req.params.arguments ?? {});
      return reply({ content: [{ type: "text", text: JSON.stringify(res, null, 2) }] });
    }
    if (req.id !== undefined) fail(`unknown method ${req.method}`);
  } catch (e) {
    fail((e as Error).message);
  }
});
process.stderr.write(`[perpify-mcp] ready · engine ${ENGINE_WS} · ${TOOLS.length} tools\n`);
