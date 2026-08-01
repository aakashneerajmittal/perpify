/**
 * Density-dialect websocket endpoints, served off one EngineBus:
 *
 *   /v1/order-and-account-updates?token=<addr>  — per-user stream + ORDER INTAKE
 *   /v1/ws/order-book                           — client sends {symbol,limit,decimal,interval}
 *   /marketDataStream?symbol=SPX-PERP           — mark/index/gap-coefficient push
 *
 * The user socket is bidirectional: the client places/cancels orders on the same
 * authenticated connection its fills arrive on. On connect it receives SESSION_INFO
 * (static params + this trader's tier) and an ACCOUNT_UPDATE snapshot, so the UI paints
 * immediately. Order commands flow through the injected `dispatch` (the venue's
 * persisting wrapper) so every trade is logged and replayable.
 *
 * Heartbeat: {type:"ping"} → {type:"pong"}. Origin policy: explicit allowlist.
 */
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { EngineBus } from "./bus.js";
import type { Command, EngineEvent, Side, Tif } from "../types.js";
import { px8 as toPx8, qty8 as toQty8, usd6 } from "../fixed.js";

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
  dispatch?: (cmd: Command) => EngineEvent[]; // persisting wrapper; defaults to bus.dispatch
  demo?: DemoConfig; // when set, auto-fund + tier new traders (investor demo)
}

export class WireServer {
  http: Server;
  wss: WebSocketServer;
  private timers: NodeJS.Timeout[] = [];
  private dispatch: (cmd: Command) => EngineEvent[];
  private clientOrderSeq = 0;
  private nonces = new Map<string, number>();

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
      res.end(JSON.stringify({ service: "perpify-engine", ok: true, market: "SPX-PERP", ts: this.bus.state.seq }));
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

  private handleUserMessage(owner: string, ws: WebSocket, raw: unknown): void {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m?.type === "ping") return void this.send(ws, { type: "pong" });

    if (m?.type === "place_order") {
      const side: Side = m.side === "sell" ? "sell" : "buy";
      const tif: Tif = m.tif === "IOC" ? "IOC" : m.tif === "POST_ONLY" ? "POST_ONLY" : "GTC";
      const qty = Number(m.qty);
      const price = Number(m.price);
      if (!(qty > 0) || !(price > 0)) return void this.send(ws, { type: "reject", reason: "bad qty/price" });
      const cmd: Command = {
        kind: "PlaceOrder",
        order: {
          id: m.id || `ui-${owner.slice(2, 8)}-${this.clientOrderSeq++}`,
          market: "SPX-PERP",
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
      this.dispatch({ kind: "CancelOrder", market: "SPX-PERP", orderId: String(m.orderId), owner });
      return;
    }

    if (m?.type === "market_close") {
      // close entire position via an IOC reduce-only through the book
      const a = this.bus.state.accounts.get(owner);
      if (!a?.position) return;
      const closeSide: Side = a.position.side === "buy" ? "sell" : "buy";
      const px = Number(this.bus.state.indexPx8) / 1e8;
      const cmd: Command = {
        kind: "PlaceOrder",
        order: {
          id: `uiclose-${owner.slice(2, 8)}-${this.clientOrderSeq++}`,
          market: "SPX-PERP",
          owner,
          side: closeSide,
          price: toPx8(px * (closeSide === "buy" ? 1.05 : 0.95)), // cross the book
          qty: a.position.qty,
          tif: "IOC",
          reduceOnly: true,
          nonce: this.nextNonce(owner),
          expiry: 0,
          signature: "0xui-testnet",
        },
      };
      this.dispatch(cmd);
    }
  }

  private route(route: string, url: URL, ws: WebSocket): void {
    if (route === "/v1/order-and-account-updates") {
      const owner = this.bus.resolveToken(url.searchParams.get("token") ?? "");
      if (!owner) return void ws.close(4001, "bad token");
      this.bus.ensureAccount(owner);

      // investor-demo: first-time trader gets testnet collateral + a behavioral tier
      if (this.opts.demo && !this.bus.hasBalance(owner)) {
        const d = this.opts.demo;
        this.dispatch({
          kind: "TierUpdate",
          reading: {
            wallet: owner,
            tier: d.tier,
            tierMult: d.tierMult,
            factors: [{ name: "demo-provisional", contribution: 1 }],
            modelVersion: "tier-v0.1-demo",
            signature: "0xdemo",
          },
        });
        this.dispatch({ kind: "Deposit", owner, amount: usd6(d.fundUsd), l1TxHash: "0xdemo-testnet-faucet" });
      }

      const unsub = this.bus.subscribe(owner, (msg) => this.send(ws, msg));
      ws.on("close", unsub);
      ws.on("message", (raw) => this.handleUserMessage(owner, ws, raw));

      // paint immediately
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
          const limit = Number(req.limit ?? 20);
          const decimal = Number(req.decimal ?? 2);
          const interval = Math.max(100, Number(req.interval ?? this.opts.bookIntervalMs ?? 500));
          if (timer) clearInterval(timer);
          const push = () => this.send(ws, this.bus.bookSnapshot(limit, decimal));
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

    // /marketDataStream — mark/index/gap-coefficient push
    const interval = this.opts.priceIntervalMs ?? 1000;
    ws.on("message", (raw) => {
      try {
        if (JSON.parse(String(raw))?.type === "ping") this.send(ws, { type: "pong" });
      } catch {
        /* ignore */
      }
    });
    const push = () =>
      this.send(ws, {
        e: "markPriceUpdate",
        s: "SPX-PERP",
        p: (Number(this.bus.state.markPx8) / 1e8).toFixed(8),
        i: (Number(this.bus.state.indexPx8) / 1e8).toFixed(8),
        gc: (Number(this.bus.state.gapCoeff6) / 1e6).toFixed(6),
        session: this.bus.state.reduceOnly ? "reduce-only" : "live",
        E: this.bus.state.seq,
      });
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
