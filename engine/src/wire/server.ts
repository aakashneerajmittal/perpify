/**
 * Density-dialect websocket endpoints, served off one multi-market EngineBus:
 *
 *   /v1/order-and-account-updates?token=<addr>  — per-user stream + ORDER INTAKE (all markets)
 *   /v1/ws/order-book                           — client sends {symbol,limit,decimal,interval}
 *   /marketDataStream?symbol=<MARKET>           — that market's mark/index/gap-coefficient push
 *
 * The user socket is bidirectional and market-agnostic: the client places/cancels orders on
 * ANY market over the one authenticated connection its fills arrive on. Each order/cancel/
 * close message names its `symbol`; the server routes it to that market. The account is
 * cross-collateralized (one balance), so on connect the trader is funded ONCE and can trade
 * every market. Book and market-data streams are per-symbol (the client re-subscribes when it
 * switches markets).
 *
 * Heartbeat: {type:"ping"} → {type:"pong"}. Origin policy: explicit allowlist.
 */
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { EngineBus } from "./bus.js";
import type { Command, MarketId, Side, Tif, TierCode } from "../types.js";
import { px8 as toPx8, qty8 as toQty8, usd6 } from "../fixed.js";
import { MARKET_IDS } from "../state.js";
import { computeGapReading } from "../risk/gapCoefficient.js";

/**
 * Provisional behavioral tier for the testnet demo, derived deterministically from
 * the wallet address. Stands in for the behavioral inference engine (which reads a
 * wallet's on-chain history) until real history exists: every wallet gets a stable
 * A–E tier, so two different wallets genuinely pay different margin for the same
 * trade (IM = notional × baseIM × gapCoeff × tierMult) and see different leverage
 * caps — the "the venue knows you" demo. Distribution skews to B/C like a real book.
 */
export function demoTierForAddress(addr: string): {
  tier: TierCode;
  tierMult: number;
  factors: { name: string; contribution: number }[];
} {
  const h = addr.toLowerCase().replace(/^0x/, "");
  let acc = 0;
  for (let i = 0; i < h.length; i++) acc = (acc * 31 + (parseInt(h[i]!, 16) || 0)) >>> 0;
  const bucket = acc % 100;
  if (bucket < 12)
    return {
      tier: "A",
      tierMult: 0.75,
      factors: [
        { name: "drawdown-discipline", contribution: 0.42 },
        { name: "sizing-vs-balance", contribution: 0.33 },
        { name: "tenure", contribution: 0.25 },
      ],
    };
  if (bucket < 42)
    return {
      tier: "B",
      tierMult: 0.9,
      factors: [
        { name: "consistent-sizing", contribution: 0.55 },
        { name: "low-drawdown-response", contribution: 0.45 },
      ],
    };
  if (bucket < 72)
    return { tier: "C", tierMult: 1.0, factors: [{ name: "provisional-baseline", contribution: 1.0 }] };
  if (bucket < 90)
    return {
      tier: "D",
      tierMult: 1.2,
      factors: [
        { name: "elevated-volatility-response", contribution: 0.6 },
        { name: "sizing-variance", contribution: 0.4 },
      ],
    };
  return {
    tier: "E",
    tierMult: 1.45,
    factors: [
      { name: "prior-liquidations", contribution: 0.68 },
      { name: "oversizing", contribution: 0.32 },
    ],
  };
}

export interface DemoConfig {
  fundUsd: number; // testnet collateral credited to a new trader on first connect
  tier: "A" | "B" | "C" | "D" | "E";
  tierMult: number;
}

export interface WireServerOpts {
  port: number;
  allowedOrigins?: string[]; // browser Origins allowed; non-browser clients (no Origin) always ok
  bookIntervalMs?: number;
  priceIntervalMs?: number;
  dispatch?: (cmd: Command) => import("../types.js").EngineEvent[]; // persisting wrapper; defaults to bus.dispatch
  demo?: DemoConfig; // when set, auto-fund + tier new traders (investor demo)
}

const MARKET_SET = new Set<string>(MARKET_IDS);
/** map an arbitrary client symbol string to a known market (case-insensitive; defaults to
 *  the flagship). Clients may send "nvda-perp" or "NVDA-PERP" — both resolve to "NVDA-PERP". */
function resolveMarket(sym: unknown): MarketId {
  if (typeof sym !== "string") return "SPX-PERP";
  const up = sym.toUpperCase();
  return MARKET_SET.has(up) ? (up as MarketId) : "SPX-PERP";
}

export class WireServer {
  http: Server;
  wss: WebSocketServer;
  private timers: NodeJS.Timeout[] = [];
  private dispatch: (cmd: Command) => import("../types.js").EngineEvent[];
  private clientOrderSeq = 0;
  private nonces = new Map<string, number>();
  /** demo: markets currently pinned to their weekend-elevated gap coefficient so the
   *  "prices the dark" story is demonstrable off-hours. main.ts's refresh skips these. */
  demoWeekendMarkets = new Set<MarketId>();

  constructor(
    public bus: EngineBus,
    public opts: WireServerOpts,
  ) {
    this.dispatch = opts.dispatch ?? ((c) => bus.dispatch(c));
    // Plain HTTP (non-upgrade) requests get a small health/status JSON — lets deploy hosts
    // (Railway/Render) healthcheck the port and gives a friendly response if someone opens
    // the engine URL directly. WebSocket upgrades are handled separately below.
    this.http = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ service: "perpify-engine", ok: true, markets: MARKET_IDS, ts: this.bus.state.seq }));
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (req, socket, head) => {
      const origin = req.headers.origin;
      const allowed = this.opts.allowedOrigins ?? [];
      // "*" = allow any browser origin (testnet demo: play-money, no real funds, so the
      // origin allowlist isn't a security boundary here). Otherwise exact-match the allowlist.
      if (origin && !allowed.includes("*") && !allowed.includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!["/v1/order-and-account-updates", "/v1/ws/order-book", "/marketDataStream"].includes(url.pathname)) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.route(url.pathname, url, ws));
    });
  }

  private nextNonce(owner: string): number {
    const n = (this.nonces.get(owner) ?? 0) + 1;
    this.nonces.set(owner, n);
    return n;
  }

  private send(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  /** find which market holds a resting order (fallback when a cancel omits its symbol) */
  private marketOfOrder(orderId: string): MarketId | null {
    for (const id of MARKET_IDS) {
      const mkt = this.bus.state.markets.get(id);
      if (mkt?.book.byId.has(orderId)) return id;
    }
    return null;
  }

  private handleUserMessage(owner: string, ws: WebSocket, raw: unknown): void {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m?.type === "ping") return void this.send(ws, { type: "pong" });

    if (m?.type === "place_order") {
      const market = resolveMarket(m.symbol);
      const side: Side = m.side === "sell" ? "sell" : "buy";
      const tif: Tif = m.tif === "IOC" ? "IOC" : m.tif === "POST_ONLY" ? "POST_ONLY" : "GTC";
      const qty = Number(m.qty);
      const price = Number(m.price);
      if (!(qty > 0) || !(price > 0)) return void this.send(ws, { type: "reject", reason: "bad qty/price" });
      const cmd: Command = {
        kind: "PlaceOrder",
        order: {
          id: m.id || `ui-${owner.slice(2, 8)}-${this.clientOrderSeq++}`,
          market,
          owner,
          side,
          price: toPx8(price),
          qty: toQty8(qty),
          tif,
          reduceOnly: !!m.reduceOnly,
          nonce: this.nextNonce(owner),
          expiry: 0,
          signature: "0xui-testnet", // real EIP-712 sig lands with production auth
        },
      };
      this.dispatch(cmd);
      return;
    }

    if (m?.type === "cancel") {
      const market = m.symbol ? resolveMarket(m.symbol) : this.marketOfOrder(String(m.orderId));
      if (!market) return; // order not resting anywhere — nothing to cancel
      this.dispatch({ kind: "CancelOrder", market, orderId: String(m.orderId), owner });
      return;
    }

    if (m?.type === "market_close") {
      // close one market's position (symbol given) or every open position (close-all)
      const a = this.bus.state.accounts.get(owner);
      if (!a || a.positions.size === 0) return;
      const markets: MarketId[] = m.symbol ? [resolveMarket(m.symbol)] : [...a.positions.keys()];
      for (const market of markets) {
        const pos = a.positions.get(market);
        if (!pos) continue;
        const mkt = this.bus.state.markets.get(market);
        if (!mkt) continue;
        const closeSide: Side = pos.side === "buy" ? "sell" : "buy";
        const px = Number(mkt.indexPx8) / 1e8;
        this.dispatch({
          kind: "PlaceOrder",
          order: {
            id: `uiclose-${owner.slice(2, 8)}-${this.clientOrderSeq++}`,
            market,
            owner,
            side: closeSide,
            price: toPx8(px * (closeSide === "buy" ? 1.05 : 0.95)), // cross the book
            qty: pos.qty,
            tif: "IOC",
            reduceOnly: true,
            nonce: this.nextNonce(owner),
            expiry: 0,
            signature: "0xui-testnet",
          },
        });
      }
      return;
    }

    if (m?.type === "demo_gap") {
      // DEMO: simulate a severe reopen gap adverse to the sender's position in the named
      // market (default: the market they hold, else the flagship), big enough to breach
      // maintenance margin across all tiers. The OracleTick handler snaps the mark and runs
      // the liquidation scan → PositionLiquidated → signed explainer. The next price tick
      // resumes the normal feed. Testnet-only theatre for the reopen demo.
      const a = this.bus.state.accounts.get(owner);
      if (!a || a.positions.size === 0) return;
      const market: MarketId = m.symbol && a.positions.has(resolveMarket(m.symbol)) ? resolveMarket(m.symbol) : [...a.positions.keys()][0]!;
      const pos = a.positions.get(market);
      const mkt = this.bus.state.markets.get(market);
      if (!pos || !mkt) return;
      const isLong = pos.side === "buy";
      const idx = Number(mkt.indexPx8);
      if (!(idx > 0)) return;
      const shocked = Math.round(idx * (isLong ? 0.7 : 1.3)); // ±30% gap
      this.dispatch({ kind: "OracleTick", market, indexPx: BigInt(shocked), source: "testnet-feed" });
      return;
    }

    if (m?.type === "demo_weekend") {
      // DEMO: toggle a market's gap coefficient between its live value and the weekend-start
      // elevated value (extended|normal, full 65.5h dark → 1.1627) so "prices the dark" is
      // demonstrable any time. Margin, maker spread, and the coefficient display all move.
      // main.ts's per-minute refresh skips markets held here.
      const market = resolveMarket(m.symbol);
      const on = !this.demoWeekendMarkets.has(market);
      if (on) this.demoWeekendMarkets.add(market);
      else this.demoWeekendMarkets.delete(market);
      const g = computeGapReading(new Date());
      const reading = on
        ? { gapCoefficient: 1.162711, session: "weekend" as const, hoursDark: 65.5 }
        : { gapCoefficient: g.gapCoefficient, session: g.session, hoursDark: g.hoursDarkRemaining };
      this.dispatch({
        kind: "RiskReading",
        reading: {
          kind: "gap",
          market,
          gapCoefficient: reading.gapCoefficient,
          session: reading.session,
          hoursDark: reading.hoursDark,
          expectedGapStd: 0,
          modelVersion: "gap-v0.1",
          signature: "0xdemo-weekend",
        },
      });
      return;
    }
  }

  private route(route: string, url: URL, ws: WebSocket): void {
    if (route === "/v1/order-and-account-updates") {
      const owner = this.bus.resolveToken(url.searchParams.get("token") ?? "");
      if (!owner) return void ws.close(4001, "bad token");
      this.bus.ensureAccount(owner);

      // investor-demo: first-time trader gets ONE cross-collateral testnet balance + a
      // provisional behavioral tier derived from their address (so different wallets pay
      // different margin — see demoTierForAddress). Funded once; trades every market.
      if (this.opts.demo && !this.bus.hasBalance(owner)) {
        const d = this.opts.demo;
        const prov = demoTierForAddress(owner);
        this.dispatch({
          kind: "TierUpdate",
          reading: {
            wallet: owner,
            tier: prov.tier,
            tierMult: prov.tierMult,
            factors: prov.factors,
            modelVersion: "tier-v0.1-demo",
            signature: "0xdemo",
          },
        });
        this.dispatch({ kind: "Deposit", owner, amount: usd6(d.fundUsd), l1TxHash: "0xdemo-testnet-faucet" });
      }

      const unsub = this.bus.subscribe(owner, (msg) => this.send(ws, msg));
      ws.on("close", unsub);
      ws.on("message", (raw) => this.handleUserMessage(owner, ws, raw));

      // paint immediately: flagship session info (tier/leverage are account-wide) + the
      // full cross-account snapshot (balance + every open position across markets)
      this.send(ws, this.bus.traderInfo(owner));
      this.send(ws, this.bus.accountSnapshot(owner));
      return;
    }

    if (route === "/v1/ws/order-book") {
      let timer: NodeJS.Timeout | null = null;
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(String(raw));
          if (req?.type === "ping") return void this.send(ws, { type: "pong" });
          const market = resolveMarket(req.symbol);
          const limit = Number(req.limit ?? 20);
          const decimal = Number(req.decimal ?? 2);
          const interval = Math.max(100, Number(req.interval ?? this.opts.bookIntervalMs ?? 500));
          if (timer) clearInterval(timer);
          const push = () => this.send(ws, this.bus.bookSnapshot(market, limit, decimal));
          push();
          timer = setInterval(push, interval);
          this.timers.push(timer);
        } catch {
          /* ignore malformed subscription */
        }
      });
      ws.on("close", () => timer && clearInterval(timer));
      return;
    }

    // /marketDataStream?symbol=<MARKET> — that market's mark/index/gap-coefficient push
    const market = resolveMarket(url.searchParams.get("symbol"));
    const interval = this.opts.priceIntervalMs ?? 1000;
    ws.on("message", (raw) => {
      try {
        if (JSON.parse(String(raw))?.type === "ping") this.send(ws, { type: "pong" });
      } catch {
        /* ignore */
      }
    });
    const push = () => {
      const mkt = this.bus.state.markets.get(market);
      if (!mkt) return;
      this.send(ws, {
        e: "markPriceUpdate",
        s: market,
        p: (Number(mkt.markPx8) / 1e8).toFixed(8),
        i: (Number(mkt.indexPx8) / 1e8).toFixed(8),
        gc: (Number(mkt.gapCoeff6) / 1e6).toFixed(6),
        session: mkt.reduceOnly ? "reduce-only" : "live",
        E: this.bus.state.seq,
      });
    };
    push();
    const t = setInterval(push, interval);
    this.timers.push(t);
    ws.on("close", () => clearInterval(t));
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(this.opts.port, () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : this.opts.port);
      });
    });
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.wss.clients) c.terminate(); // don't wait on half-open sockets
    this.wss.close();
    await new Promise((r) => this.http.close(() => r(null)));
  }
}
