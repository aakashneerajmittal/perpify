import { describe, expect, it } from "vitest";
import { canonicalTierMessage, verifyTierAttestation } from "../src/wire/attest.js";

// Shared golden vector (also pinned in connect/test/attest.test.ts — the two MUST agree):
//   key 0x59c6...690d → address 0x7099...79C8, signing the canonical message below.
const A = { wallet: "0x1111111111111111111111111111111111111111", tier: "A", tierMult: 0.75, modelVersion: "dna-v0.1-connect", issuedAt: 1_700_000_000_000 };
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SIG =
  "0xffe1b79785993818392f4cbe752ae147dcc9ae535baa40cd701c5b4944d34f4014cd59736091e76db1f29b669a1c5a5d0c357bc2570d58b188a6c9b192dd604d1b";
const NOW = 1_700_000_001_000; // 1s after issuedAt

describe("tier attestation (verifier)", () => {
  it("builds the versioned canonical message", () => {
    expect(canonicalTierMessage(A)).toBe(
      "perpify-tier-attest-v1|0x1111111111111111111111111111111111111111|A|0.75|dna-v0.1-connect|1700000000000",
    );
  });

  it("accepts a valid signature from the expected connect-service address", () => {
    expect(verifyTierAttestation(A, SIG, ADDR, { nowMs: NOW })).toEqual({ ok: true });
  });

  it("rejects the wrong signer", () => {
    expect(verifyTierAttestation(A, SIG, "0x0000000000000000000000000000000000000001", { nowMs: NOW }).ok).toBe(false);
  });

  it("rejects a tampered reading (tier/mult upgraded)", () => {
    expect(verifyTierAttestation({ ...A, tierMult: 1.45 }, SIG, ADDR, { nowMs: NOW }).ok).toBe(false);
  });

  it("rejects a stale attestation", () => {
    expect(verifyTierAttestation(A, SIG, ADDR, { nowMs: A.issuedAt + 48 * 3600 * 1000 }).ok).toBe(false);
  });

  it("rejects a malformed signature", () => {
    expect(verifyTierAttestation(A, "0xdeadbeef", ADDR, { nowMs: NOW }).ok).toBe(false);
  });

  it("rejects when no pubkey is configured (caller should skip verification instead)", () => {
    expect(verifyTierAttestation(A, SIG, "", { nowMs: NOW }).ok).toBe(false);
  });
});
