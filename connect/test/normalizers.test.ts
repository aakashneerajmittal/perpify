import { describe, expect, it } from "vitest";
import { normalize, normalizeBinance, normalizeBybit, normalizeOkx, normSymbol } from "../src/normalizers.js";
import { reconstruct } from "../src/reconstruct.js";

describe("normSymbol", () => {
  it("strips quote/PERP/SWAP tags and non-alphanumerics", () => {
    expect(normSymbol("BTCUSDT")).toBe("BTC");
    expect(normSymbol("BTC-USDT")).toBe("BTC");
    expect(normSymbol("ETH-PERP")).toBe("ETH");
    expect(normSymbol("AAPL")).toBe("AAPL");
    expect(normSymbol("")).toBe("?");
    expect(normSymbol(null)).toBe("?");
  });
});

describe("normalizeBinance (USD-M futures userTrades)", () => {
  const raw = [
    { symbol: "BTCUSDT", side: "BUY", price: "100", qty: "1", commission: "0.1", realizedPnl: "0", time: 0 },
    { symbol: "BTCUSDT", side: "SELL", price: "110", qty: "1", commission: "0.1", realizedPnl: "10", time: 86_400_000 },
  ];
  it("maps a bare trade array to normalized fills", () => {
    const fills = normalizeBinance(raw);
    expect(fills.length).toBe(2);
    expect(fills[0]).toMatchObject({ ts: 0, symbol: "BTC", side: 1, qty: 1, price: 100, fee: 0.1, assetClass: "crypto" });
    expect(fills[1]!.side).toBe(-1);
    expect(fills[1]!.realizedPnl).toBe(10);
  });
  it("reconstructs into a single round-trip net of fees", () => {
    const rts = reconstruct(normalizeBinance(raw));
    expect(rts.length).toBe(1);
    expect(rts[0]!.pnl).toBeCloseTo(10 - 0.2, 9);
  });
});

describe("normalizeBybit (v5 execution/list)", () => {
  const raw = {
    result: {
      list: [
        { symbol: "ETHUSDT", side: "Buy", execPrice: "50", execQty: "2", execFee: "0.05", execTime: "0" },
        { symbol: "ETHUSDT", side: "Sell", execPrice: "55", execQty: "2", execFee: "0.05", execTime: "86400000", closedPnl: "10" },
      ],
    },
  };
  it("maps the wrapped list and reconstructs", () => {
    const fills = normalizeBybit(raw);
    expect(fills.length).toBe(2);
    expect(fills[0]).toMatchObject({ symbol: "ETH", side: 1, qty: 2, price: 50, fee: 0.05 });
    const rts = reconstruct(fills);
    expect(rts.length).toBe(1);
    expect(rts[0]!.notional).toBe(100); // 50 × 2
    expect(rts[0]!.pnl).toBeCloseTo((55 - 50) * 2 - 0.1, 9);
  });
});

describe("normalizeOkx (v5 trade/fills)", () => {
  const raw = {
    data: [
      { instId: "BTC-USDT-SWAP", side: "buy", fillPx: "100", fillSz: "1", fee: "-0.1", ts: "0" },
      { instId: "BTC-USDT-SWAP", side: "sell", fillPx: "90", fillSz: "1", fee: "-0.1", ts: "86400000", fillPnl: "-10" },
    ],
  };
  it("maps fills (absolute fee) and reconstructs a loss", () => {
    const fills = normalizeOkx(raw);
    expect(fills[0]).toMatchObject({ symbol: "BTCUSDT", side: 1, price: 100, fee: 0.1 });
    const rts = reconstruct(fills);
    expect(rts[0]!.pnl).toBeCloseTo(-10 - 0.2, 9);
    expect(rts[0]!.providedPnl).toBe(-10);
  });
});

describe("normalize dispatcher", () => {
  it("routes by exchange id", () => {
    const fills = normalize("binance", [{ symbol: "BTCUSDT", side: "BUY", price: "1", qty: "1", commission: "0", time: 0 }]);
    expect(fills.length).toBe(1);
  });
  it("throws on an unknown exchange", () => {
    // @ts-expect-error deliberately invalid exchange id
    expect(() => normalize("kraken", [])).toThrow();
  });
});
