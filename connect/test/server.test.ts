import { describe, expect, it } from "vitest";
import { runConnect, type Transport } from "../src/index.js";

const now = () => 1_700_000_000_000;
const SECRET = "dont-leak-me";

describe("runConnect", () => {
  it("fetches, reconstructs, and summarizes a round-trip (OKX)", async () => {
    let calls = 0;
    const transport: Transport = async () => {
      calls++;
      if (calls === 1)
        return {
          status: 200,
          json: {
            data: [
              { instId: "BTC-USDT-SWAP", side: "sell", fillPx: "110", fillSz: "1", fee: "0", ts: "86400000", billId: "2", fillPnl: "10" },
              { instId: "BTC-USDT-SWAP", side: "buy", fillPx: "100", fillSz: "1", fee: "0", ts: "0", billId: "1" },
            ],
          },
        };
      return { status: 200, json: { data: [] } };
    };
    const res = await runConnect({ exchange: "okx", apiKey: "k", apiSecret: SECRET, passphrase: "p", account0: 1000 }, { transport, now });
    expect(res.ok).toBe(true);
    expect(res.summary!.roundTrips).toBe(1);
    expect(res.summary!.winRate).toBe(1);
    expect(res.roundTrips![0]!.pnl).toBeCloseTo(10, 9);
    expect(res.roundTrips![0]!.side).toBe(1);
  });

  it("rejects missing credentials without touching the network", async () => {
    let called = false;
    const transport: Transport = async () => {
      called = true;
      return { status: 200, json: {} };
    };
    const res = await runConnect({ exchange: "okx", apiKey: "", apiSecret: "" } as any, { transport, now });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("a fetch-layer failure returns an error and never echoes the secret", async () => {
    const transport: Transport = async () => {
      throw new Error("connection refused");
    };
    const res = await runConnect({ exchange: "binance", apiKey: "k", apiSecret: SECRET, symbols: ["BTCUSDT"] }, { transport, now });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});
