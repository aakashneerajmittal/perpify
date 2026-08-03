/**
 * PerpifyClient — a typed TypeScript client for the Perpify engine's WebSocket protocol.
 * Wraps the three endpoints (account/order intake, order book, market data) behind a small
 * promise/callback API so external integrators (and the MCP server) can trade, stream, and
 * read risk state without hand-writing the Density wire dialect.
 *
 *   const c = new PerpifyClient({ engineWs: "wss://perpify-engine.onrender.com", wallet });
 *   await c.connect();
 *   c.onAccount((a) => console.log(a.balances, a.positions));
 *   c.placeOrder({ symbol: "NVDA-PERP", side: "buy", qty: 0.5, price: 190, tif: "IOC" });
 *
 * Node usage requires the `ws` package; in a browser the global WebSocket is used.
 */
export type Side = "buy" | "sell";
export type Tif = "GTC" | "IOC" | "POST_ONLY";
export type Market = "SPX-PERP" | "NVDA-PERP" | "AAPL-PERP" | "MSFT-PERP" | "GOOGL-PERP" | "AMZN-PERP";

export interface PerpifyClientOpts {
  engineWs: string; // e.g. wss://perpify-engine.onrender.com  (no trailing path)
  wallet: string; // 0x + 40 hex (the testnet token / account)
  WebSocketImpl?: any; // inject `ws` in Node; defaults to global WebSocket
}

export interface OrderReq {
  symbol: Market;
  side: Side;
  qty: number;
  price: number;
  tif?: Tif;
  reduceOnly?: boolean;
  id?: string;
}

export interface TriggerReq {
  symbol: Market;
  side: Side;
  qty: number;
  triggerPx: number;
  triggerAbove: boolean;
  limitPx?: number;
  reduceOnly?: boolean;
  id?: string;
}

type Handler = (msg: any) => void;

export class PerpifyClient {
  private ws: any = null;
  private WS: any;
  private handlers: { account: Handler[]; order: Handler[]; session: Handler[]; liquidation: Handler[]; conditional: Handler[] } = {
    account: [],
    order: [],
    session: [],
    liquidation: [],
    conditional: [],
  };
  constructor(private opts: PerpifyClientOpts) {
    this.WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    if (!this.WS) throw new Error("No WebSocket implementation — pass WebSocketImpl (the `ws` package) in Node.");
  }

  connect(): Promise<void> {
    const url = `${this.opts.engineWs.replace(/\/$/, "")}/v1/order-and-account-updates?token=${this.opts.wallet}`;
    this.ws = new this.WS(url);
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e: any) => reject(e);
      this.ws.onmessage = (ev: any) => this.route(ev.data);
    });
  }

  private route(raw: any): void {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === "SESSION_INFO") return this.fire("session", m);
    if (m.type === "CONDITIONAL_ORDERS_SNAPSHOT") return this.fire("conditional", m);
    switch (m.eventType) {
      case "ACCOUNT_UPDATE":
        return this.fire("account", m.eventData);
      case "ORDER_TRADE_UPDATE":
      case "ORDER_UPDATE":
        return this.fire("order", m.eventData);
      case "LIQUIDATION_EXPLAINER":
        return this.fire("liquidation", m.eventData);
      case "CONDITIONAL_ORDER_UPDATE":
        return this.fire("conditional", m.eventData);
    }
  }
  private fire(k: keyof typeof this.handlers, msg: any): void {
    for (const h of this.handlers[k]) h(msg);
  }
  private send(obj: any): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  onAccount(h: Handler) { this.handlers.account.push(h); }
  onOrder(h: Handler) { this.handlers.order.push(h); }
  onSession(h: Handler) { this.handlers.session.push(h); }
  onLiquidation(h: Handler) { this.handlers.liquidation.push(h); }
  onConditional(h: Handler) { this.handlers.conditional.push(h); }

  placeOrder(o: OrderReq): boolean {
    return this.send({ type: "place_order", symbol: o.symbol, side: o.side, qty: o.qty, price: o.price, tif: o.tif ?? "GTC", reduceOnly: !!o.reduceOnly, id: o.id });
  }
  cancel(symbol: Market, orderId: string): boolean {
    return this.send({ type: "cancel", symbol, orderId });
  }
  marketClose(symbol?: Market): boolean {
    return this.send({ type: "market_close", symbol });
  }
  placeTrigger(t: TriggerReq): boolean {
    return this.send({ type: "place_trigger", symbol: t.symbol, side: t.side, qty: t.qty, triggerPx: t.triggerPx, triggerAbove: t.triggerAbove, limitPx: t.limitPx ?? 0, reduceOnly: t.reduceOnly !== false, id: t.id });
  }
  cancelTrigger(symbol: Market, triggerId: string): boolean {
    return this.send({ type: "cancel_trigger", symbol, triggerId });
  }
  ping(): boolean {
    return this.send({ type: "ping" });
  }
  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** One-shot health read (markets list, seq) from the engine's HTTP endpoint. */
export async function fetchVenueHealth(engineHttp: string): Promise<{ service: string; ok: boolean; markets: string[]; ts: number }> {
  const res = await fetch(engineHttp.replace(/\/$/, "") + "/");
  return res.json();
}
