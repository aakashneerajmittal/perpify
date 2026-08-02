import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EngineBus } from "../src/wire/bus.js";
import { WireServer } from "../src/wire/server.js";
import type { WireMessage } from "../src/wire/density.js";
import { px8, qty8, usd6 } from "../src/fixed.js";
import {
  ALICE,
  BOB,
  deposit,
  gapReading,
  mkOrderCmd,
  resetIds,
  tick,
  tierUpdate,
} from "./helpers.js";

beforeEach(() => resetIds());

function collect(bus: EngineBus, owner: string): WireMessage[] {
  const out: WireMessage[] = [];
  bus.subscribe(owner, (m) => out.push(m));
  return out;
}

describe("Density wire mappers via the bus", () => {
  it("a fill emits ORDER_TRADE_UPDATE in the audited shape + coalesced ACCOUNT_UPDATE", () => {
    const bus = new EngineBus();
    const aliceMsgs = collect(bus, ALICE);
    const bobMsgs = collect(bus, BOB);

    bus.dispatch(tick(5000));
    bus.dispatch(deposit(ALICE, 100_000));
    bus.dispatch(deposit(BOB, 100_000));
    bus.dispatch(mkOrderCmd(ALICE, "sell", 5000, 1, { id: "mk1" }));
    bus.dispatch(mkOrderCmd(BOB, "buy", 5000, 1, { tif: "IOC", id: "tk1" }));

    const otu = bobMsgs.filter((m) => m.eventType === "ORDER_TRADE_UPDATE").at(-1)!;
    const d = otu.eventData as any;
    expect(otu.orderID).toBe("tk1");
    expect(d.symbol).toBe("SPX-PERP");
    expect(d.side).toBe("BUY");
    expect(d.orderType).toBe("MARKET"); // IOC mapping
    expect(d.status).toBe("FILLED");
    expect(d.q).toBe("1.00000000");
    expect(d.z).toBe("1.00000000");
    expect(d.ap).toBe("5000.00000000");
    expect(d.ps).toBe("BOTH");
    expect(typeof d.T).toBe("number");

    // maker side got its own update with maker flag semantics
    const makerOtu = aliceMsgs.filter((m) => m.eventType === "ORDER_TRADE_UPDATE").at(-1)!;
    expect((makerOtu.eventData as any).m).toBe(true);

    // coalesced account updates: balances + signed position, Binance field names
    const au = bobMsgs.filter((m) => m.eventType === "ACCOUNT_UPDATE").at(-1)!;
    const ad = au.eventData as any;
    expect(ad.balances[0].asset).toBe("USDC");
    expect(Number(ad.balances[0].walletBalance)).toBeGreaterThan(0);
    expect(ad.positions[0].quantity).toBe("1.00000000"); // long = positive
    expect(ad.positions[0].marginType).toBe("isolated");
    const aliceAu = aliceMsgs.filter((m) => m.eventType === "ACCOUNT_UPDATE").at(-1)!;
    expect((aliceAu.eventData as any).positions[0].quantity).toBe("-1.00000000"); // short = negative
  });

  it("a rejection emits ORDER_UPDATE with remarks", () => {
    const bus = new EngineBus();
    const msgs = collect(bus, ALICE);
    bus.dispatch(tick(5000));
    bus.dispatch(mkOrderCmd(ALICE, "buy", 5000, 1, { id: "r1" })); // no collateral
    const rej = msgs.find((m) => m.eventType === "ORDER_UPDATE")!;
    expect((rej.eventData as any).orderStatus).toBe("REJECTED");
    expect((rej.eventData as any).statusRemarks).toContain("insufficient collateral");
  });

  it("book snapshot aggregates by decimal with cumulative volume and bid/ask split", () => {
    const bus = new EngineBus();
    bus.dispatch(tick(5000));
    bus.dispatch(deposit(ALICE, 1_000_000));
    bus.dispatch(mkOrderCmd(ALICE, "buy", 4999.98, 1, { id: "b1" }));
    bus.dispatch(mkOrderCmd(ALICE, "buy", 4999.92, 2, { id: "b2" })); // same 4999.9 bucket at 1dp
    bus.dispatch(mkOrderCmd(ALICE, "buy", 4998.5, 1, { id: "b3" }));
    bus.dispatch(mkOrderCmd(ALICE, "sell", 5001.0, 2, { id: "s1" }));

    const wire = bus.bookSnapshot("SPX-PERP", 20, 1);
    expect(wire.s).toBe("SPX-PERP");
    expect(wire.d).toBe(1);
    expect(wire.b[0]!.P).toBe("4999.9");
    expect(wire.b[0]!.Q).toBe("3.00000000"); // 1 + 2 aggregated into one bucket
    expect(wire.b[1]!.P).toBe("4998.5");
    expect(wire.b[1]!.V).toBe("4.00000000"); // cumulative
    expect(wire.a[0]!.P).toBe("5001.0");
    expect(Number(wire.bp) + Number(wire.ap)).toBeCloseTo(100, 1);
    expect(wire.b[0]!.p).toBe("100.00"); // biggest level = 100%
  });

  it("position monitoring: liq price honors the live gap coefficient (thesis on the wire)", () => {
    const bus = new EngineBus();
    bus.dispatch(tick(5000));
    bus.dispatch(deposit(ALICE, 100_000));
    bus.dispatch(deposit(BOB, 100_000));
    bus.dispatch(tierUpdate(ALICE, "A", 0.85));
    bus.dispatch(mkOrderCmd(BOB, "sell", 5000, 1, { id: "m1" }));
    bus.dispatch(mkOrderCmd(ALICE, "buy", 5000, 1, { tif: "IOC", id: "t1" }));

    const before = bus.positionMonitoring(ALICE)[0]!;
    bus.dispatch(gapReading(1.5, "weekend"));
    const after = bus.positionMonitoring(ALICE)[0]!;

    expect(Number(before.liquidationPrice)).toBeGreaterThan(0);
    // weekend repricing raises MM → liquidation price moves closer to entry for a long
    expect(Number(after.liquidationPrice)).toBeGreaterThan(Number(before.liquidationPrice));
    expect(Number(after.maintenanceMargin)).toBeGreaterThan(Number(before.maintenanceMargin));
    expect(after.marginMode).toBe("isolated");
  });
});

describe("wire server: live sockets speak the dialect", () => {
  let bus: EngineBus;
  let server: WireServer;
  let port: number;

  beforeEach(async () => {
    resetIds();
    bus = new EngineBus();
    bus.dispatch(tick(5000));
    bus.dispatch(deposit(ALICE, 100_000));
    bus.dispatch(deposit(BOB, 100_000));
    server = new WireServer(bus, { port: 0, priceIntervalMs: 60_000, bookIntervalMs: 60_000 });
    port = await server.listen();
  });

  afterEach(async () => {
    await server.close();
  });

  const nextMessage = (ws: WebSocket, filter?: (m: any) => boolean): Promise<any> =>
    new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("ws timeout")), 4000);
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (!filter || filter(m)) {
          clearTimeout(to);
          resolve(m);
        }
      });
      ws.on("error", reject);
    });

  it("order-and-account stream: auth by token, ORDER_TRADE_UPDATE arrives over the socket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${BOB}`);
    await new Promise((r) => ws.on("open", r));
    const incoming = nextMessage(ws, (m) => m.eventType === "ORDER_TRADE_UPDATE");

    bus.dispatch(mkOrderCmd(ALICE, "sell", 5000, 1, { id: "wm1" }));
    bus.dispatch(mkOrderCmd(BOB, "buy", 5000, 1, { tif: "IOC", id: "wt1" }));

    const msg = await incoming;
    expect(msg.orderID).toBe("wt1");
    expect(msg.eventData.status).toBe("FILLED");
    ws.close();
  });

  it("heartbeat: ping → pong; bad token → close 4001; browser origin gated", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${ALICE}`);
    await new Promise((r) => ws.on("open", r));
    const pong = nextMessage(ws, (m) => m.type === "pong");
    ws.send(JSON.stringify({ type: "ping" }));
    expect((await pong).type).toBe("pong");
    ws.close();

    const bad = new WebSocket(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=nope`);
    const code = await new Promise<number>((r) => bad.on("close", (c) => r(c)));
    expect(code).toBe(4001);

    const gated = new WebSocket(`ws://127.0.0.1:${port}/marketDataStream?symbol=SPX-PERP`, {
      headers: { origin: "https://evil.example" },
    });
    await new Promise<void>((r) => gated.on("error", () => r()));
  });

  it("order-book endpoint: subscribe message → aggregated snapshots stream", async () => {
    bus.dispatch(mkOrderCmd(ALICE, "buy", 4999, 2, { id: "ob1" }));
    bus.dispatch(mkOrderCmd(ALICE, "sell", 5001, 3, { id: "ob2" }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws/order-book`);
    await new Promise((r) => ws.on("open", r));
    const snap = nextMessage(ws, (m) => m.s === "SPX-PERP");
    ws.send(JSON.stringify({ symbol: "SPX-PERP", limit: 10, decimal: 0, interval: 200 }));
    const book = await snap;
    expect(book.b[0].P).toBe("4999");
    expect(book.a[0].P).toBe("5001");
    ws.close();
  });

  it("marketDataStream carries mark, index, and the Perpify gap-coefficient extension", async () => {
    bus.dispatch(gapReading(1.42, "weekend"));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/marketDataStream?symbol=SPX-PERP`);
    const m = await nextMessage(ws, (x) => x.e === "markPriceUpdate");
    expect(m.s).toBe("SPX-PERP");
    expect(Number(m.p)).toBe(5000);
    expect(m.gc).toBe("1.420000");
    ws.close();
  });
});
