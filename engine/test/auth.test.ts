import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { orderFields, signOrder, recoverOrderSigner, verifyOrder, orderDigest, PERPIFY_EIP712_DOMAIN } from "../src/auth/eip712.js";

// deterministic test key (well-known Hardhat account #0 private key — testnet only)
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wallet = new Wallet(PK);

const baseMsg = {
  owner: wallet.address,
  market: "NVDA-PERP",
  side: "buy",
  qty8: "50000000", // 0.5 @ 1e8
  price8: "18250000000", // 182.5 @ 1e8
  tif: "GTC",
  reduceOnly: false,
  nonce: "1",
  expiry: "0",
};

describe("EIP-712 signed-order auth (auth-v1)", () => {
  it("a wallet-signed order recovers to the signer and verifies", async () => {
    const f = orderFields(baseMsg);
    const sig = await signOrder(wallet, f);
    expect(recoverOrderSigner(f, sig)).toBe(wallet.address);
    expect(verifyOrder(f, sig)).toBe(true);
  });

  it("domain is Base Sepolia + the deployed Settlement contract", () => {
    expect(PERPIFY_EIP712_DOMAIN.chainId).toBe(84532);
    expect(PERPIFY_EIP712_DOMAIN.verifyingContract).toBe("0xB6703a8822AB7113EBcAa35830C7b22AE2204c43");
  });

  it("tampering with any signed field breaks verification (qty)", async () => {
    const f = orderFields(baseMsg);
    const sig = await signOrder(wallet, f);
    const tampered = orderFields({ ...baseMsg, qty8: "60000000" }); // 0.5 → 0.6
    expect(verifyOrder(tampered, sig)).toBe(false);
  });

  it("tampering with price or side breaks verification", async () => {
    const f = orderFields(baseMsg);
    const sig = await signOrder(wallet, f);
    expect(verifyOrder(orderFields({ ...baseMsg, price8: "18250000001" }), sig)).toBe(false);
    expect(verifyOrder(orderFields({ ...baseMsg, side: "sell" }), sig)).toBe(false);
  });

  it("a signature from a different wallet does not authenticate the claimed owner", async () => {
    const other = Wallet.createRandom();
    const f = orderFields(baseMsg); // owner is `wallet`
    const sigByOther = await signOrder(other, f);
    // recovers to `other`, which is NOT the claimed owner → verifyOrder false
    expect(recoverOrderSigner(f, sigByOther)).toBe(other.address);
    expect(verifyOrder(f, sigByOther)).toBe(false);
  });

  it("a garbage signature returns null rather than throwing", () => {
    const f = orderFields(baseMsg);
    expect(recoverOrderSigner(f, "0xdeadbeef")).toBeNull();
    expect(verifyOrder(f, "0xnotasig")).toBe(false);
  });

  it("the same order produces a stable digest (canonical hashing)", async () => {
    const a = orderDigest(orderFields(baseMsg));
    const b = orderDigest(orderFields({ ...baseMsg }));
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changing the nonce changes the digest (replay-distinct)", () => {
    const d1 = orderDigest(orderFields({ ...baseMsg, nonce: "1" }));
    const d2 = orderDigest(orderFields({ ...baseMsg, nonce: "2" }));
    expect(d1).not.toBe(d2);
  });
});
