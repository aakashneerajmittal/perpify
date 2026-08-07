import { describe, expect, it } from "vitest";
import { addressOf, buildSignedOrder } from "./signedOrder.js";
import { orderFields, verifyOrder } from "../engine/src/auth/eip712.js";
import { px8, qty8 } from "../engine/src/fixed.js";

// A well-known testnet key (hardhat account #1) → its address.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("EIP-712 signed order (agent wallet auth)", () => {
  it("derives the owner address from the private key", () => {
    expect(addressOf(KEY)).toBe(ADDR);
  });

  it("produces a signature the engine's own verifier accepts (interop)", async () => {
    const msg = await buildSignedOrder(KEY, { market: "NVDA-PERP", side: "buy", qty8: qty8(0.5), price8: px8(190), tif: "IOC", nonce: 1 });
    expect(msg.owner).toBe(ADDR);
    expect(msg.type).toBe("place_order_signed");
    // the SDK signs exactly what the engine hashes → engine verifyOrder must accept it
    expect(verifyOrder(orderFields(msg as any), String(msg.signature))).toBe(true);
  });

  it("rejects a tampered quantity (signature bound to the size)", async () => {
    const msg = await buildSignedOrder(KEY, { market: "NVDA-PERP", side: "buy", qty8: qty8(0.5), price8: px8(190), nonce: 2 });
    const tampered = { ...msg, qty8: qty8(50).toString() };
    expect(verifyOrder(orderFields(tampered as any), String(msg.signature))).toBe(false);
  });

  it("rejects a flipped side (signature bound to side/price too)", async () => {
    const msg = await buildSignedOrder(KEY, { market: "NVDA-PERP", side: "buy", qty8: qty8(1), price8: px8(100), nonce: 3 });
    expect(verifyOrder(orderFields({ ...msg, side: "sell" } as any), String(msg.signature))).toBe(false);
  });

  it("is deterministic for identical inputs", async () => {
    const a = await buildSignedOrder(KEY, { market: "AAPL-PERP", side: "sell", qty8: qty8(2), price8: px8(220), nonce: 7 });
    const b = await buildSignedOrder(KEY, { market: "AAPL-PERP", side: "sell", qty8: qty8(2), price8: px8(220), nonce: 7 });
    expect(a.signature).toBe(b.signature);
  });
});
