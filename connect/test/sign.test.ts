import { describe, expect, it } from "vitest";
import { okxTimestamp, signBinanceQuery, signBybit, signOkx } from "../src/sign.js";

describe("request signing", () => {
  it("Binance matches the official documented example vector", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const qs =
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(signBinanceQuery(secret, qs)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("Bybit signs timestamp + key + recvWindow + payload (hex)", () => {
    expect(
      signBybit("testsecret", { timestamp: "1700000000000", apiKey: "testkey", recvWindow: "5000", payload: "category=linear&limit=50" }),
    ).toBe("f66ddf8fc6f238f709172e3c9f11c154db14f7ba6a39b1ac736e74b3703126e4");
  });

  it("OKX signs base64(timestamp + method + requestPath + body)", () => {
    expect(
      signOkx("okxsecret", { timestamp: "2020-12-08T09:08:57.715Z", method: "GET", requestPath: "/api/v5/trade/fills?instType=SWAP", body: "" }),
    ).toBe("guFQlxEcX1YymF36NKVRIQXciCkiqbMUs4j2t/OZU5o=");
  });

  it("OKX upper-cases the method in the signature", () => {
    const a = signOkx("s", { timestamp: "t", method: "get", requestPath: "/p", body: "" });
    const b = signOkx("s", { timestamp: "t", method: "GET", requestPath: "/p", body: "" });
    expect(a).toBe(b);
  });

  it("okxTimestamp is ISO-8601 with milliseconds", () => {
    expect(okxTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});
