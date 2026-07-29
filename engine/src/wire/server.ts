/**
 * The three Density-dialect websocket endpoints, served off one EngineBus:
 *
 *   /v1/order-and-account-updates?token=<addr>  — per-user order + account stream
 *   /v1/ws/order-book                           — client sends {symbol,limit,decimal,interval}
 *   /marketDataStream?symbol=SPX-PERP           — mark/index price stream
 *
 * Heartbeat: {type:"ping"} → {type:"pong"} (the Density client's 15s ping).
 * Origin policy: explicit allowlist (unlike the audited CheckOrigin:true — noted
 * in the reuse map as a pattern NOT to copy).
 */
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { EngineBus } from "./bus.js";

export interface WireServerOpts {
  port: number;
  allowedOrigins?: string[]; // undefined = allow non-browser clients only (no Origin header)
  bookIntervalMs?: number;
  priceIntervalMs?: number;
}

export class WireServer {
  http: Server;
  wss: WebSocketServer;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    public bus: EngineBus,
    public opts: WireServerOpts,
  ) {
    this.http = createServer();
    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (req, socket, head) => {
      const origin = req.headers.origin;
      if (origin && !(this.opts.allowedOrigins ?? []).includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = url.pathname;
      if (!["/v1/order-and-account-updates", "/v1/ws/order-book", "/marketDataStream"].includes(route)) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.route(route, url, ws));
    });
  }

  private heartbeat(ws: WebSocket): void {
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        /* non-JSON frames ignored */
      }
    });
  }

  private route(route: string, url: URL, ws: WebSocket): void {
    this.heartbeat(ws);

    if (route === "/v1/order-and-account-updates") {
      const owner = this.bus.resolveToken(url.searchParams.get("token") ?? "");
      if (!owner) {
        ws.close(4001, "bad token");
        return;
      }
      this.bus.ensureAccount(owner);
      const unsub = this.bus.subscribe(owner, (msg) => ws.send(JSON.stringify(msg)));
      ws.on("close", unsub);
      return;
    }

    if (route === "/v1/ws/order-book") {
      let timer: NodeJS.Timeout | null = null;
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(String(raw));
          if (req?.type === "ping") return;
          const limit = Number(req.limit ?? 20);
          const decimal = Number(req.decimal ?? 2);
          const interval = Math.max(100, Number(req.interval ?? this.opts.bookIntervalMs ?? 500));
          if (timer) clearInterval(timer);
          const push = () => ws.readyState === ws.OPEN && ws.send(JSON.stringify(this.bus.bookSnapshot(limit, decimal)));
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

    // /marketDataStream — mark/index push
    const interval = this.opts.priceIntervalMs ?? 1000;
    const push = () => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(
        JSON.stringify({
          e: "markPriceUpdate",
          s: "SPX-PERP",
          p: (Number(this.bus.state.markPx8) / 1e8).toFixed(8),
          i: (Number(this.bus.state.indexPx8) / 1e8).toFixed(8),
          gc: (Number(this.bus.state.gapCoeff6) / 1e6).toFixed(6), // Perpify extension: live gap coefficient
          E: this.bus.state.seq,
        }),
      );
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
    this.wss.close();
    await new Promise((r) => this.http.close(() => r(null)));
  }
}
