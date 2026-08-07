import { describe, expect, it } from "vitest";
import { verifyMessage } from "ethers";
import { canonicalTierMessage, signTierAttestation } from "../src/attest.js";

// Shared golden vector — MUST match engine/test/attest.test.ts.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const A = { wallet: "0x1111111111111111111111111111111111111111", tier: "A", tierMult: 0.75, modelVersion: "dna-v0.1-connect", issuedAt: 1_700_000_000_000 };
const SIG =
  "0xffe1b79785993818392f4cbe752ae147dcc9ae535baa40cd701c5b4944d34f4014cd59736091e76db1f29b669a1c5a5d0c357bc2570d58b188a6c9b192dd604d1b";

describe("tier attestation (signer)", () => {
  it("builds the same canonical message the engine verifies", () => {
    expect(canonicalTierMessage(A)).toBe(
      "perpify-tier-attest-v1|0x1111111111111111111111111111111111111111|A|0.75|dna-v0.1-connect|1700000000000",
    );
  });

  it("signs to the golden vector and recovers to the connect address", async () => {
    const sig = await signTierAttestation(A, KEY);
    expect(sig).toBe(SIG);
    expect(verifyMessage(canonicalTierMessage(A), sig).toLowerCase()).toBe(ADDR.toLowerCase());
  });
});
