/**
 * EIP-712 signed-order authentication (auth-v1).
 *
 * Turns the testnet "your address is your token" stub into real, verifiable authorization: a
 * trader signs each order with their wallet over a typed Order struct, and the engine recovers
 * the signer and checks it matches the claimed owner before the order touches the book. Replay
 * is prevented by the per-account monotonic nonce the engine already enforces (core.ts).
 *
 * Canonicalization: the struct is signed over the SAME 1e8 integer strings the wire carries
 * (qty8 / price8), never a re-parsed float — so the signer and the verifier hash byte-identical
 * data and there is no float round-trip drift. This module is verify-if-present: an order with
 * no `signature` (or the legacy "0xui-testnet" stub) takes the existing testnet path unchanged,
 * so the live demo is untouched; a signed order is authenticated and rejected on any mismatch.
 */
import { verifyTypedData, getAddress, TypedDataEncoder } from "ethers";

/** Base Sepolia; verifyingContract is the deployed Settlement so the domain is venue-specific. */
export const PERPIFY_EIP712_DOMAIN = {
  name: "Perpify",
  version: "1",
  chainId: 84532,
  verifyingContract: "0xB6703a8822AB7113EBcAa35830C7b22AE2204c43",
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: "owner", type: "address" },
    { name: "market", type: "string" },
    { name: "side", type: "string" },
    { name: "qty", type: "uint256" }, // 1e8 fixed-point, as an integer
    { name: "price", type: "uint256" }, // 1e8 fixed-point, as an integer
    { name: "tif", type: "string" },
    { name: "reduceOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" }, // 0 = good-till-cancel (nonce is the replay guard)
  ],
} as const;

/** The exact fields that are hashed and signed. All numeric fields are decimal strings. */
export interface SignedOrderFields {
  owner: string;
  market: string;
  side: string; // "buy" | "sell"
  qty: string; // 1e8 integer
  price: string; // 1e8 integer
  tif: string; // "GTC" | "IOC" | "POST_ONLY"
  reduceOnly: boolean;
  nonce: string;
  expiry: string;
}

/** Normalize a wire message's fields into the canonical signable struct (throws on bad shape). */
export function orderFields(msg: {
  owner: string;
  market: string;
  side: string;
  qty8: string | number | bigint;
  price8: string | number | bigint;
  tif: string;
  reduceOnly: boolean;
  nonce: string | number | bigint;
  expiry: string | number | bigint;
}): SignedOrderFields {
  return {
    owner: getAddress(msg.owner),
    market: String(msg.market),
    side: msg.side === "sell" ? "sell" : "buy",
    qty: BigInt(msg.qty8).toString(),
    price: BigInt(msg.price8).toString(),
    tif: msg.tif === "IOC" ? "IOC" : msg.tif === "POST_ONLY" ? "POST_ONLY" : "GTC",
    reduceOnly: !!msg.reduceOnly,
    nonce: BigInt(msg.nonce).toString(),
    expiry: BigInt(msg.expiry ?? 0).toString(),
  };
}

/** The EIP-712 digest (for logging / debugging / on-chain cross-checks). */
export function orderDigest(fields: SignedOrderFields): string {
  return TypedDataEncoder.hash(PERPIFY_EIP712_DOMAIN, ORDER_TYPES as never, fields);
}

/**
 * Recover the signer of a signed order. Returns the checksummed address, or null if the
 * signature is malformed. Callers must compare the result to the claimed owner.
 */
export function recoverOrderSigner(fields: SignedOrderFields, signature: string): string | null {
  try {
    return getAddress(verifyTypedData(PERPIFY_EIP712_DOMAIN, ORDER_TYPES as never, fields, signature));
  } catch {
    return null;
  }
}

/** True iff `signature` is a valid EIP-712 order signature by `fields.owner`. */
export function verifyOrder(fields: SignedOrderFields, signature: string): boolean {
  const rec = recoverOrderSigner(fields, signature);
  return rec !== null && rec === getAddress(fields.owner);
}

/**
 * Sign an order with an ethers signer (Wallet or browser signer). Used by tests and the SDK;
 * the browser flow calls the wallet's signTypedData with the same domain/types/fields.
 */
export async function signOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: { signTypedData: (domain: any, types: any, value: any) => Promise<string> },
  fields: SignedOrderFields,
): Promise<string> {
  return signer.signTypedData(PERPIFY_EIP712_DOMAIN, ORDER_TYPES, fields);
}
