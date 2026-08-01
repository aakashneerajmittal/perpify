import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EngineBus } from "../src/wire/bus.js";
import { WireServer } from "../src/wire/server.js";
import { deposit, resetIds, tick } from "./helpers.js";

const ALICE = "0xaaaa000000000000000000000000000000000001";
const MAKER = "0x3a4ke00000000000000000000000000000000009";
const INVESTOR = "0x1111111111111111111111111111111111111111";

let bus: EngineBus;
let server: WireServer;
let port: number;

beforeEach(async () => {
  resetIds();
  bus = new EngineBus();
  bus.dispatch(tick(5000));
  bus.dispatch(deposit(MAKER, 1_000_000));
  // maker rests a sell so an investor buy can fill
  bus.dispatch({
    kind: "PlaceOrder",
    order: {
      id: "mk-sell",
      market: "SPX-PERP",
      owner: MAKER,
      side: "sell",
      price: 500_100_000_000n,
      qty: 500_000_000n,
      tif: "GTC",
      reduceOnly: false,
      nonce: 1,
      expiry: 0,
      signature: "0x",
    },
  });
  server = new WireServer(bus, {
    port: 0,
    priceIntervalMs: 60_000,
    bookIntervalMs: 60_000,
    demo: { fundUsd: 100_000, tier: "B", tierMult: 0.9 },
  });
  port = await server.listen();
});

afterEach(async () => {
  await server.close();
});

/** buffer every message from the moment the socket exists — no attach-after-open race */
function openBuffered(url: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  const ws = new WebSocket(url);
  const msgs: any[] = [];
  ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}

const waitFor = (msgs: any[], filter: (m: any) => boolean, ms = 4000): Promise<any> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const hit = msgs.find(filter);
      if (hit) {
        clearInterval(iv);
        resolve(hit);
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error("waitFor timeout"));
      }
    }, 15);
  });

describe("browser order intake (investor demo path)", () => {
  it("demo connect → SESSION_INFO + funded ACCOUNT_UPDATE snapshot", async () => {
    const { ws, msgs } = await openBuffered(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${INVESTOR}`);
    const info = await waitFor(msgs, (m) => m.type === "SESSION_INFO");
    expect(info.tier).toBe("B");
    expect(info.tierMult).toBeCloseTo(0.9, 6);
    expect(info.baseImBps).toBeGreaterThan(0);
    const snap = await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE");
    expect(Number(snap.eventData.balances[0].walletBalance)).toBeCloseTo(100_000, 0);
    ws.close();
  });

  it("place_order over the socket fills against the maker and returns ORDER_TRADE_UPDATE + position", async () => {
    const { ws, msgs } = await openBuffered(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${INVESTOR}`);
    await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE"); // funded snapshot

    ws.send(JSON.stringify({ type: "place_order", side: "buy", qty: 0.3, price: 5002, tif: "IOC" }));
    const otu = await waitFor(msgs, (m) => m.eventType === "ORDER_TRADE_UPDATE" && m.eventData.status === "FILLED");
    expect(otu.eventData.side).toBe("BUY");
    expect(Number(otu.eventData.z)).toBeCloseTo(0.3, 6);

    const acct = await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE" && m.eventData.positions.length > 0);
    expect(acct.eventData.positions[0].quantity).toBe("0.30000000");
    expect(Number(acct.eventData.positions[0].isolatedWallet)).toBeGreaterThan(0);
    ws.close();
  });

  it("market_close flattens the position", async () => {
    bus.dispatch({
      kind: "PlaceOrder",
      order: {
        id: "mk-buy",
        market: "SPX-PERP",
        owner: MAKER,
        side: "buy",
        price: 499_900_000_000n,
        qty: 1_000_000_000n,
        tif: "GTC",
        reduceOnly: false,
        nonce: 2,
        expiry: 0,
        signature: "0x",
      },
    });
    const { ws, msgs } = await openBuffered(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${INVESTOR}`);
    await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE");
    ws.send(JSON.stringify({ type: "place_order", side: "buy", qty: 0.3, price: 5002, tif: "IOC" }));
    await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE" && m.eventData.positions.length > 0);

    ws.send(JSON.stringify({ type: "market_close" }));
    await waitFor(msgs, (m) => m.eventType === "ACCOUNT_UPDATE" && m.eventData.positions.length === 0);
    ws.close();
  });
});
