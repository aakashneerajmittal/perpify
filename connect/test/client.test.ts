import { describe, expect, it } from "vitest";
import { fetchTradeHistory, type HttpRequest, type Transport } from "../src/client.js";

const SECRET = "SUPER-SECRET-shouldnt-leak";
const KEY = "APIKEY123";
const now = () => 1_700_000_000_000;

/** records every request and replays a queue of responses (last one repeats). */
function mockTransport(responses: any[]): { transport: Transport; reqs: HttpRequest[] } {
  const reqs: HttpRequest[] = [];
  let i = 0;
  const transport: Transport = async (req) => {
    reqs.push(req);
    const json = responses[Math.min(i, responses.length - 1)];
    i++;
    return { status: 200, json };
  };
  return { transport, reqs };
}

const noSecretAnywhere = (r: HttpRequest) => {
  expect(r.url).not.toContain(SECRET);
  for (const v of Object.values(r.headers)) expect(v).not.toContain(SECRET);
};

describe("fetchTradeHistory — Binance", () => {
  it("requires symbols (userTrades is per-symbol)", async () => {
    const { transport } = mockTransport([[]]);
    await expect(fetchTradeHistory("binance", { apiKey: KEY, apiSecret: SECRET }, { transport, now })).rejects.toThrow(/per-symbol/);
  });

  it("paginates by fromId until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, k) => ({ symbol: "BTCUSDT", side: k % 2 ? "SELL" : "BUY", price: "100", qty: "1", commission: "0", time: k, id: k + 1 }));
    const tail = [{ symbol: "BTCUSDT", side: "SELL", price: "110", qty: "1", commission: "0", time: 999, id: 101 }];
    const { transport, reqs } = mockTransport([full, tail]);
    const fills = await fetchTradeHistory("binance", { apiKey: KEY, apiSecret: SECRET }, { transport, now, symbols: ["BTCUSDT"], limit: 100 });
    expect(fills.length).toBe(101);
    expect(reqs.length).toBe(2);
    expect(reqs[1]!.url).toContain("fromId=101"); // maxId(100) + 1
  });

  it("puts the derived signature + key on the wire but never the secret", async () => {
    const { transport, reqs } = mockTransport([[]]);
    await fetchTradeHistory("binance", { apiKey: KEY, apiSecret: SECRET }, { transport, now, symbols: ["BTCUSDT"] });
    expect(reqs[0]!.url).toContain("signature=");
    expect(reqs[0]!.headers["X-MBX-APIKEY"]).toBe(KEY);
    noSecretAnywhere(reqs[0]!);
  });
});

describe("fetchTradeHistory — Bybit", () => {
  it("paginates by cursor until it clears and signs via headers", async () => {
    const page1 = { result: { list: [{ symbol: "ETHUSDT", side: "Buy", execPrice: "50", execQty: "1", execFee: "0", execTime: "1" }], nextPageCursor: "c2" } };
    const page2 = { result: { list: [{ symbol: "ETHUSDT", side: "Sell", execPrice: "55", execQty: "1", execFee: "0", execTime: "2" }], nextPageCursor: "" } };
    const { transport, reqs } = mockTransport([page1, page2]);
    const fills = await fetchTradeHistory("bybit", { apiKey: KEY, apiSecret: SECRET }, { transport, now });
    expect(fills.length).toBe(2);
    expect(reqs.length).toBe(2);
    expect(reqs[1]!.url).toContain("cursor=c2");
    expect(reqs[0]!.headers["X-BAPI-SIGN"]).toBeTruthy();
    noSecretAnywhere(reqs[0]!);
  });
});

describe("fetchTradeHistory — OKX", () => {
  it("paginates by billId until a short page and signs via headers", async () => {
    const page1 = { data: Array.from({ length: 100 }, (_, k) => ({ instId: "BTC-USDT-SWAP", side: k % 2 ? "sell" : "buy", fillPx: "100", fillSz: "1", fee: "0", ts: String(k), billId: String(k + 1) })) };
    const page2 = { data: [{ instId: "BTC-USDT-SWAP", side: "sell", fillPx: "90", fillSz: "1", fee: "0", ts: "999", billId: "101" }] };
    const { transport, reqs } = mockTransport([page1, page2]);
    const fills = await fetchTradeHistory("okx", { apiKey: KEY, apiSecret: SECRET, passphrase: "pp" }, { transport, now, limit: 100 });
    expect(fills.length).toBe(101);
    expect(reqs.length).toBe(2);
    expect(reqs[1]!.url).toContain("after=100"); // last billId of page 1
    expect(reqs[0]!.headers["OK-ACCESS-SIGN"]).toBeTruthy();
    expect(reqs[0]!.headers["OK-ACCESS-PASSPHRASE"]).toBe("pp");
    noSecretAnywhere(reqs[0]!);
  });
});
