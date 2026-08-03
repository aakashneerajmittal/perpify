import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Wallet } from "ethers";
import { EngineBus } from "../src/wire/bus.js";
import { WireServer } from "../src/wire/server.js";
import { orderFields, signOrder } from "../src/auth/eip712.js";
import { px8, qty8 } from "../src/fixed.js";
import { ALICE, deposit, mkOrderCmd, resetIds, tick } from "./helpers.js";

const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wallet = new Wallet(PK);

function nextMatch(ws: WebSocket, pred: (m: any) => boolean, timeoutMs = 2500): Promise<any> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    const onMsg = (raw: WebSocket.RawData) => {
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (pred(m)) {
        clearTimeout(to);
        ws.off("message", onMsg);
        resolve(m);
      }
    };
    ws.on("message", onMsg);
  });
}

function connect(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/order-and-account-updates?token=${token}`);
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

describe("EIP-712 signed order over the wire", () => {
  let bus: EngineBus;
  let server: WireServer;
  let port: number;

  beforeEach(async () => {
    resetIds();
    bus = new EngineBus();
    bus.dispatch(tick(5000));
    bus.dispatch(deposit(ALICE, 100_000)); // maker
    bus.dispatch(deposit(wallet.address.toLowerCase(), 100_000)); // the signer
    bus.dispatch(mkOrderCmd(ALICE, "sell", 5000, 3, { id: "mk1" })); // resting liquidity to cross
    server = new WireServer(bus, { port: 0, allowedOrigins: ["*"] });
    port = await server.listen();
  });

  afterEach(async () => {
    await server.close();
  });

  function signedMsg(over: Record<string, unknown> = {}) {
    const raw = {
      owner: wallet.address,
      market: "SPX-PERP",
      side: "buy",
      qty8: qty8(1).toString(),
      price8: px8(5100).toString(), // marketable: crosses the 5000 resting sell
      tif: "IOC",
      reduceOnly: false,
      nonce: "1",
      expiry: "0",
      ...over,
    };
    return raw;
  }

  it("admits and fills a valid wallet-signed order", async () => {
    const ws = await connect(port, wallet.address);
    const raw = signedMsg();
    const sig = await signOrder(wallet, orderFields(raw));
    const filled = nextMatch(ws, (m) => m.eventType === "ORDER_TRADE_UPDATE" && m.eventData?.status === "FILLED");
    ws.send(JSON.stringify({ type: "place_order_signed", id: "sg1", symbol: "SPX-PERP", ...raw, signature: sig }));
    const otu = await filled;
    expect(otu.eventData.side).toBe("BUY");
    expect(otu.eventData.z).toBe("1.00000000"); // fully filled 1 contract
    ws.close();
  });

  it("rejects a tampered signed order (qty changed after signing)", async () => {
    const ws = await connect(port, wallet.address);
    const raw = signedMsg();
    const sig = await signOrder(wallet, orderFields(raw)); // sign qty=1
    const reject = nextMatch(ws, (m) => m.type === "reject");
    // send with qty doubled — signature no longer matches the fields
    ws.send(JSON.stringify({ type: "place_order_signed", id: "sg2", symbol: "SPX-PERP", ...raw, qty8: qty8(2).toString(), signature: sig }));
    const r = await reject;
    expect(r.reason).toBe("bad signature");
    ws.close();
  });

  it("rejects a signed order whose signer is not this connection's owner", async () => {
    const other = Wallet.createRandom();
    // connect as `other`, but present an order signed by `wallet` claiming `wallet` as owner
    const ws = await connect(port, other.address);
    const raw = signedMsg(); // owner = wallet
    const sig = await signOrder(wallet, orderFields(raw));
    const reject = nextMatch(ws, (m) => m.type === "reject");
    ws.send(JSON.stringify({ type: "place_order_signed", id: "sg3", symbol: "SPX-PERP", ...raw, signature: sig }));
    const r = await reject;
    expect(r.reason).toContain("connection's owner");
    ws.close();
  });
});
