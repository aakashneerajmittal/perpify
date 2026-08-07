/**
 * Tier attestation (signer). Signs a verified tier reading so the venue can trust it on mainnet —
 * the engine verifies with engine/src/wire/attest.ts. EIP-191 personal_sign over a versioned
 * canonical message; `canonicalTierMessage` here MUST byte-match the engine's (both pinned to a
 * shared golden vector in tests).
 *
 * Runtime-gated by CONNECT_ATTEST_KEY (see server.runConnect): set on mainnet to attach a real
 * signature; unset on testnet, where the reading carries the stub signature and the engine trusts it.
 */
import { Wallet } from "ethers";

export interface TierAttestation {
  wallet: string;
  tier: string;
  tierMult: number;
  modelVersion: string;
  issuedAt: number; // epoch ms
}

export function canonicalTierMessage(a: TierAttestation): string {
  // MUST byte-match engine/src/wire/attest.ts
  return `perpify-tier-attest-v1|${a.wallet.toLowerCase()}|${a.tier}|${a.tierMult}|${a.modelVersion}|${a.issuedAt}`;
}

/** EIP-191 sign the canonical reading with the connect-service key. */
export async function signTierAttestation(a: TierAttestation, privateKey: string): Promise<string> {
  return new Wallet(privateKey).signMessage(canonicalTierMessage(a));
}
