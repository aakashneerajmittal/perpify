/**
 * Perpify MCP server — exposes the venue to AI agents as tools (Architecture §4.6, M3).
 *
 * A minimal, dependency-free Model Context Protocol server over stdio (newline-delimited
 * JSON-RPC 2.0). It reuses the engine's own pure risk functions for the read/simulate tools
 * and the PerpifyClient for live actions, so an agent can price margin, look up a wallet's
 * behavioral tier, read live gap risk, check venue health, and place orders — all on-thesis.
 *
 * Run:   PERPIFY_ENGINE_WS=wss://perpify-engine.onrender.com npx tsx sdk/mcpServer.ts
 * Wire it into an MCP client (Claude Desktop / Code) as a stdio server (see sdk/README.md).
 */
import { createInterface } from "node:readline";
import { imRequired, mmRequired, collateralRequired } from "../engine/src/margin.js";
import { usd6, toCoeff6 } from "../engine/src/fixed.js";
import { DEFAULT_PARAMS } from "../engine/src/state.js";
import { computeGapReading, gapScaleFor } from "../engine/src/risk/gapCoefficient.js";
import { demoTierForAddress, scoreTier, TIER_MULT } from "../engine/src/risk/tierScore.js";
import { PerpifyClient, fetchVenueHealth, type Market } from "./perpifyClient.js";
import type { TierCode } from "../engine/src/types.js";

const ENGINE_WS = process.env.PERPIFY_ENGINE_WS || "wss://perpify-engine.onrender.com";
const ENGINE_HTTP = process.env.PERPIFY_ENGINE_HTTP || ENGINE_WS.replace(/^ws/, "http");
const num6 = (v: bigint): number => Number(v) / 1e6;

const TOOLS = [
  {
    name: "simulate_margin",
    description: "Compute Perpify's initial/maintenance margin and effective leverage for a hypothetical position. IM = notional × baseIM × gapCoefficient × tierMult.",
    inputSchema: {
      type: "object",
      properties: {
        notionalUsd: { type: "number", description: "position notional in USD" },
        tier: { type: "string", enum: ["A", "B", "C", "D", "E"], description: "behavioral tier" },
        gapCoefficient: { type: "number", description: "gap coefficient (>=1.0); use query_risk_state for the live value" },
      },
      required: ["notionalUsd"],
    },
  },
  {
    name: "lookup_behavioral_tier",
    description: "Return a wallet's provisional behavioral tier (A–E), margin multiplier and named contributing factors.",
    inputSchema: { type: "object", properties: { address: { type: "string", description: "0x wallet address" } }, required: ["address"] },
  },
  {
    name: "query_risk_state",
    description: "Live AI gap coefficient + session for a market (prices the dark period into margin). Markets: SPX-PERP, NVDA-PERP, AAPL-PERP, MSFT-PERP, GOOGL-PERP, AMZN-PERP.",
    inputSchema: { type: "object", properties: { market: { type: "string", description: "market id, e.g. NVDA-PERP" } }, required: ["market"] },
  },
  {
    name: "read_venue_health",
    description: "Read the live venue status: service ok, the list of markets, and the engine sequence number.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "place_order",
    description: "Place an order on the testnet venue over the account WebSocket. Returns the order/account updates received shortly after.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "0x wallet address (testnet token)" },
        symbol: { type: "string", description: "market id, e.g. NVDA-PERP" },
        side: { type: "string", enum: ["buy", "sell"] },
        qty: { type: "number" },
        price: { type: "number" },
        tif: { type: "string", enum: ["GTC", "IOC", "POST_ONLY"] },
        reduceOnly: { type: "boolean" },
      },
      required: ["wallet", "symbol", "side", "qty", "price"],
    },
  },
];

async function callTool(name: string, args: any): Promise<any> {
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
  if (name === "lookup_behavioral_tier") {
    const t = demoTierForAddress(String(args.address));
    return { address: args.address, tier: t.tier, tierMult: t.tierMult, factors: t.factors, note: "provisional (cold-start, address-derived); the live model (tier-v0.2) refines from observed behavior" };
  }
  if (name === "query_risk_state") {
    const market = String(args.market);
    const scale = gapScaleFor(market);
    const g = computeGapReading(new Date(), "normal", scale);
    return { market, gapCoefficient: g.gapCoefficient, session: g.session, hoursDarkRemaining: g.hoursDarkRemaining, darkScale: scale, modelVersion: g.modelVersion };
  }
  if (name === "read_venue_health") {
    return await fetchVenueHealth(ENGINE_HTTP);
  }
  if (name === "place_order") {
    const { default: WebSocket } = await import("ws"); // lazy: only live actions need a WS impl
    const c = new PerpifyClient({ engineWs: ENGINE_WS, wallet: String(args.wallet), WebSocketImpl: WebSocket });
    const updates: any[] = [];
    c.onOrder((o) => updates.push({ kind: "order", ...o }));
    c.onAccount((a) => updates.push({ kind: "account", balances: a.balances, positions: a.positions }));
    await c.connect();
    const ok = c.placeOrder({ symbol: args.symbol as Market, side: args.side, qty: Number(args.qty), price: Number(args.price), tif: args.tif ?? "GTC", reduceOnly: !!args.reduceOnly });
    await new Promise((r) => setTimeout(r, 1500));
    c.close();
    return { sent: ok, updates: updates.slice(0, 8) };
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
      return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "perpify", version: "0.1.0" } });
    }
    if (req.method === "notifications/initialized" || req.method?.startsWith("notifications/")) return; // no id
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
process.stderr.write(`[perpify-mcp] ready · engine ${ENGINE_WS}\n`);
