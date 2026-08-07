/**
 * Tier attestation (verifier). Before the engine seeds a connect-derived tier, it can require the
 * reading to be signed by the trusted connect service. EIP-191 personal_sign over a versioned
 * canonical message.
 *
 * TESTNET: no CONNECT_ATTEST_PUBKEY set → the connect_tier handler skips verification (trusts as
 * sent, matching the existing testnet token=wallet auth). MAINNET: set CONNECT_ATTEST_PUBKEY and the
 * handler requires a valid, fresh signature recovering to that address.
 *
 * `canonicalTierMessage` MUST byte-match connect/src/attest.ts (the signer). It's versioned so the
 * format can evolve without silent mismatches; both sides are pinned to a shared golden test vector.
 */
import { verifyMessage } from "ethers";

export interface TierAttestation {
  wallet: string;
  tier: string;
  tierMult: number;
  modelVersion: string;
  issuedAt: number; // epoch ms
}

export function canonicalTierMessage(a: TierAttestation): string {
  return `perpify-tier-attest-v1|${a.wallet.toLowerCase()}|${a.tier}|${a.tierMult}|${a.modelVersion}|${a.issuedAt}`;
}

/** Verify a connect-service signature over the reading and that it's fresh. */
export function verifyTierAttestation(
  a: TierAttestation,
  signature: string,
  expectedAddress: string,
  opts: { maxAgeMs?: number; nowMs?: number } = {},
): { ok: boolean; reason?: string } {
  const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const nowMs = opts.nowMs ?? Date.now();
  if (!signature || !expectedAddress) return { ok: false, reason: "missing signature or attest pubkey" };
  if (!a.issuedAt || nowMs - a.issuedAt > maxAgeMs || a.issuedAt - nowMs > 60_000) {
    return { ok: false, reason: "attestation stale or future-dated" };
  }
  let recovered: string;
  try {
    recovered = verifyMessage(canonicalTierMessage(a), signature);
  } catch {
    return { ok: false, reason: "bad signature" };
  }
  return recovered.toLowerCase() === expectedAddress.toLowerCase() ? { ok: true } : { ok: false, reason: "signer mismatch" };
}
