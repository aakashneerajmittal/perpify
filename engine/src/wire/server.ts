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
import { computeGapReading, gapScaleFor } from "../risk/gapCoefficient.js";
import { demoTierForAddress, scoreTier, type ConnectProvisional } from "../risk/tierScore.js";
import { verifyTierAttestation } from "./attest.js";
import { orderFields, verifyOrder } from "../auth/eip712.js";
import { getAddress } from "ethers";
import { handleRest } from "./rest.js";

// Behavioral tier scoring lives in risk/tierScore (cold-start provisional + live model).
// Re-exported here for existing importers.
export { demoTierForAddress };

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
  vaultSnapshot?: () => unknown; // live PVault tranche state for /vaultStream (read-only broadcast)
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
  /** live sockets per connected owner — for pushing fresh SESSION_INFO on tier changes */
  private sockets = new Map<string, Set<WebSocket>>();
  /** demo: markets currently pinned to their weekend-elevated gap coefficient so the
   *  "prices the dark" story is demonstrable off-hours. main.ts's refresh skips these. */
  demoWeekendMarkets = new Set<MarketId>();
  /** verified provisional tiers carried in from a read-only connect, per wallet — used as the
   *  cold-start tier until live on-venue behavior takes over (see refreshTiers / scoreTier). */
  private connectTiers = new Map<string, ConnectProvisional>();
  /** demo: markets forced into low-confidence reduce-only (new exposure blocked). */
  demoReduceOnlyMarkets = new Set<MarketId>();

  constructor(
    public bus: EngineBus,
    public opts: WireServerOpts,
  ) {
    this.dispatch = opts.dispatch ?? ((c) => bus.dispatch(c));
    // Plain HTTP (non-upgrade) requests get a small health/status JSON — lets deploy hosts
    // (Railway/Render) healthcheck the port and gives a friendly response if someone opens
    // the engine URL directly. WebSocket upgrades are handled separately below.
    this.http = createServer((req, res) => {
      // REST compatibility layer (24h stats, candles, depth, funding, sentiment, …) with CORS,
      // so the Binance-shaped frontend's fetches succeed instead of CORS-failing. Falls through
      // to the health JSON for anything it doesn't recognize.
      const cors = {
        origin: (req.headers.origin as string) || undefined,
        reqHeaders: (req.headers["access-control-request-headers"] as string) || undefined,
      };
      try {
        const rest = handleRest(this.bus, req.method ?? "GET", req.url ?? "/", Date.now(), cors);
        if (rest) {
          res.writeHead(rest.status, rest.headers);
          res.end(rest.body);
          return;
        }
      } catch (e) {
        console.error("[rest-error]", (e as Error).message);
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": cors.origin || "*",
        "access-control-allow-credentials": "true",
        "vary": "Origin",
      });
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
      if (!["/v1/order-and-account-updates", "/v1/ws/order-book", "/marketDataStream", "/vaultStream"].includes(url.pathname)) {
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

    // EIP-712 signed order (auth-v1): the trader signs the canonical Order struct with their
    // wallet; the engine recovers the signer, checks it matches the claimed owner (and this
    // connection's owner), and only then admits the order. Client-chosen nonce/expiry are
    // carried through to the engine's existing replay/expiry enforcement. Verify-if-present:
    // unsigned orders above are unaffected, so the live demo path is untouched.
    if (m?.type === "place_order_signed") {
      let fields;
      try {
        fields = orderFields(m);
      } catch {
        return void this.send(ws, { type: "reject", reason: "malformed signed order" });
      }
      if (!verifyOrder(fields, String(m.signature ?? ""))) {
        return void this.send(ws, { type: "reject", reason: "bad signature" });
      }
      // bind the signed order to this authenticated connection (canonicalize both sides)
      let connOwner: string | null = null;
      try {
        connOwner = getAddress(owner);
      } catch {
        connOwner = null;
      }
      if (connOwner && connOwner !== fields.owner) {
        return void this.send(ws, { type: "reject", reason: "signer is not this connection's owner" });
      }
      const market = resolveMarket(m.symbol ?? m.market);
      const price = BigInt(m.price8);
      const qty = BigInt(m.qty8);
      if (!(qty > 0n) || !(price > 0n)) return void this.send(ws, { type: "reject", reason: "bad qty/price" });
      this.dispatch({
        kind: "PlaceOrder",
        order: {
          id: m.id || `sig-${fields.owner.slice(2, 8)}-${this.clientOrderSeq++}`,
          market,
          // engine accounts are keyed lowercase (matching the connection's token owner); the
          // signature was verified against the checksummed owner above.
          owner: fields.owner.toLowerCase(),
          side: fields.side === "sell" ? "sell" : "buy",
          price,
          qty,
          tif: fields.tif === "IOC" ? "IOC" : fields.tif === "POST_ONLY" ? "POST_ONLY" : "GTC",
          reduceOnly: fields.reduceOnly,
          nonce: Number(fields.nonce),
          expiry: Number(fields.expiry),
          signature: String(m.signature),
        },
      });
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

    if (m?.type === "demo_reduce_only") {
      // DEMO: force a market into low-confidence reduce-only (new exposure blocked, closes
      // allowed) — the "oracle confidence dropped → venue protects itself" story.
      const market = resolveMarket(m.symbol);
      const on = !this.demoReduceOnlyMarkets.has(market);
      if (on) this.demoReduceOnlyMarkets.add(market);
      else this.demoReduceOnlyMarkets.delete(market);
      this.dispatch({
        kind: "RiskReading",
        reading: { kind: "confidence", market, confidence: on ? 0.35 : 0.96, dispersionBps: on ? 40 : 3, stalenessMs: 200, reduceOnly: on, signature: "0xdemo-confidence" },
      });
      return;
    }

    if (m?.type === "place_trigger") {
      // conditional order (TP / SL / stop). The child order fires when the mark crosses.
      const market = resolveMarket(m.symbol);
      const side: Side = m.side === "sell" ? "sell" : "buy";
      const triggerPx = Number(m.triggerPx);
      const qty = Number(m.qty);
      if (!(triggerPx > 0) || !(qty > 0)) return void this.send(ws, { type: "reject", reason: "bad trigger" });
      const limit = Number(m.limitPx) || 0;
      this.dispatch({
        kind: "PlaceTrigger",
        trigger: {
          id: m.id || `trg-${owner.slice(2, 8)}-${this.clientOrderSeq++}`,
          market,
          owner,
          triggerPx: toPx8(triggerPx),
          triggerAbove: !!m.triggerAbove,
          side,
          qty: toQty8(qty),
          limitPx: limit > 0 ? toPx8(limit) : 0n,
          reduceOnly: m.reduceOnly !== false, // brackets default reduce-only
          nonce: this.nextNonce(owner),
          expiry: 0,
          signature: "0xui-testnet",
        },
      });
      return;
    }

    if (m?.type === "cancel_trigger") {
      const market = resolveMarket(m.symbol);
      this.dispatch({ kind: "CancelTrigger", market, triggerId: String(m.triggerId), owner });
      return;
    }

    if (m?.type === "connect_tier") {
      // A verified provisional tier from the read-only connect service (Trader-DNA scored the
      // trader's real off-venue history). Seeds the cold-start tier and is applied immediately;
      // live on-venue behavior overrides it once past the activity floor (see refreshTiers).
      // TESTNET: trusted as sent. MAINNET TODO: verify a connect-service signature first.
      const TIERS: TierCode[] = ["A", "B", "C", "D", "E"];
      const tier = String(m.tier) as TierCode;
      const tierMult = Number(m.tierMult);
      if (!TIERS.includes(tier) || !isFinite(tierMult) || tierMult < 0.5 || tierMult > 2) return;
      const factors = Array.isArray(m.factors)
        ? m.factors.slice(0, 8).map((f: any) => ({ name: String(f?.name ?? "factor"), contribution: Number(f?.contribution) || 0 }))
        : [];
      const modelVersion = typeof m.modelVersion === "string" ? m.modelVersion : "dna-connect";
      // Mainnet attestation: if a connect-service pubkey is configured, require a valid, fresh
      // signature over this exact reading (recovering to that address). Testnet leaves it unset
      // and trusts as sent (matches the token=wallet testnet auth).
      const attestPubkey = process.env.CONNECT_ATTEST_PUBKEY;
      if (attestPubkey) {
        const v = verifyTierAttestation(
          { wallet: owner, tier, tierMult, modelVersion, issuedAt: Number(m.issuedAt) || 0 },
          String(m.signature ?? ""),
          attestPubkey,
        );
        if (!v.ok) return; // reject unattested / invalid connect tiers on mainnet
      }
      const cp: ConnectProvisional = { tier, tierMult, factors, modelVersion };
      this.connectTiers.set(owner, cp);
      this.dispatch({
        kind: "TierUpdate",
        reading: { wallet: owner, tier, tierMult, factors, modelVersion, signature: "0xconnect-verified" },
      });
      for (const sock of this.sockets.get(owner) ?? []) this.send(sock, this.bus.traderInfo(owner));
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
      const scale = gapScaleFor(market);
      const g = computeGapReading(new Date(), "normal", scale);
      const weekendCoeff = Math.min(2.5, 1 + (1.162711 - 1) * scale); // per-symbol dark premium
      const reading = on
        ? { gapCoefficient: weekendCoeff, session: "weekend" as const, hoursDark: 65.5 }
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

      if (!this.sockets.has(owner)) this.sockets.set(owner, new Set());
      this.sockets.get(owner)!.add(ws);
      const unsub = this.bus.subscribe(owner, (msg) => this.send(ws, msg));
      ws.on("close", () => {
        unsub();
        this.sockets.get(owner)?.delete(ws);
      });
      ws.on("message", (raw) => this.handleUserMessage(owner, ws, raw));

      // paint immediately: flagship session info (tier/leverage are account-wide) + the
      // full cross-account snapshot (balance + every open position across markets) + any
      // armed conditional orders
      this.send(ws, this.bus.traderInfo(owner));
      this.send(ws, this.bus.accountSnapshot(owner));
      this.send(ws, { type: "CONDITIONAL_ORDERS_SNAPSHOT", orders: this.bus.openTriggers(owner) });
      // resting limit orders, each as an ORDER_TRADE_UPDATE(NEW) — so open orders survive refresh
      for (const msg of this.bus.restingOrders(owner)) this.send(ws, msg);
      // recent order history (fills + cancels) — so Order History / PnL tabs survive refresh
      this.send(ws, { type: "ORDER_HISTORY_SNAPSHOT", records: this.bus.orderHistorySnapshot(owner) });
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

    if (route === "/vaultStream") {
      // read-only broadcast of the live PVault tranche state (Senior/Junior NAV, APY, TVL,
      // reserve, catastrophe flag). Interactive deposits/drills are client-side previews.
      const interval = Math.max(1000, this.opts.priceIntervalMs ?? 1000);
      ws.on("message", (raw) => {
        try {
          if (JSON.parse(String(raw))?.type === "ping") this.send(ws, { type: "pong" });
        } catch {
          /* ignore */
        }
      });
      const pushV = () => {
        const snap = this.opts.vaultSnapshot?.();
        if (snap) this.send(ws, { e: "vaultState", ...(snap as object) });
      };
      pushV();
      const vt = setInterval(pushV, interval);
      this.timers.push(vt);
      ws.on("close", () => clearInterval(vt));
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
        conf: mkt.confidence.toFixed(3),
        session: mkt.reduceOnly ? "reduce-only" : "live",
        E: this.bus.state.seq,
      });
    };
    push();
    const t = setInterval(push, interval);
    this.timers.push(t);
    ws.on("close", () => clearInterval(t));
  }

  /**
   * Recompute each connected trader's behavioral tier from their live behavior (tier-v0.2)
   * and, when it changes, dispatch a TierUpdate + push fresh SESSION_INFO so the tier card
   * updates live — the "watch your margin change as you trade" demo.
   */
  private refreshTiers(): void {
    for (const [owner, wss] of this.sockets) {
      if (wss.size === 0) continue;
      const a = this.bus.state.accounts.get(owner);
      if (!a) continue;
      const r = scoreTier(owner, a.behavior, a.realizedPnl6, this.bus.state.seq, this.connectTiers.get(owner));
      const cur = a.tier;
      const changed = !cur || cur.tier !== r.tier || Math.abs(Number(cur.tierMult6) / 1e6 - r.tierMult) > 1e-9;
      if (!changed) continue;
      this.dispatch({
        kind: "TierUpdate",
        reading: { wallet: owner, tier: r.tier, tierMult: r.tierMult, factors: r.factors, modelVersion: r.modelVersion, signature: "0xtier-live" },
      });
      for (const ws of wss) this.send(ws, this.bus.traderInfo(owner));
    }
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(this.opts.port, () => {
        const addr = this.http.address();
        this.timers.push(setInterval(() => this.refreshTiers(), 15_000)); // live behavioral tiers
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
