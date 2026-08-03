/**
 * EIP-712 order signing (frontend, auth-v1) — the wallet-signature half of real DEX auth.
 *
 * Mirrors engine/src/auth/eip712.ts EXACTLY (same domain, same Order types) so a signature
 * produced here verifies there. When the `signedOrders` feature flag is on AND the session is a
 * real connected wallet (not the demo burner), the order form routes market/limit orders
 * through here: it builds the canonical struct, asks the wallet to sign it (viem, over
 * window.ethereum), and dispatches a signed-order action. The demo burner has no injected
 * signer, so it always falls back to the existing testnet path — the live demo is untouched.
 *
 * Replay safety: the engine enforces a strictly-increasing per-account nonce, so we hand it a
 * monotonic nonce (a localStorage high-water mark, floored at wall-clock ms).
 */
import { createWalletClient, custom, getAddress } from "viem";

export const PERPIFY_EIP712_DOMAIN = {
  name: "Perpify",
  version: "1",
  chainId: 84532, // Base Sepolia
  verifyingContract: "0xB6703a8822AB7113EBcAa35830C7b22AE2204c43" as `0x${string}`,
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: "owner", type: "address" },
    { name: "market", type: "string" },
    { name: "side", type: "string" },
    { name: "qty", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "tif", type: "string" },
    { name: "reduceOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export interface CanonicalOrder {
  owner: `0x${string}`;
  market: string;
  side: "buy" | "sell";
  qty8: bigint; // 1e8 fixed-point
  price8: bigint; // 1e8 fixed-point
  tif: "GTC" | "IOC" | "POST_ONLY";
  reduceOnly: boolean;
  nonce: bigint;
  expiry: bigint;
}

/** A monotonic nonce per address (strictly increasing across orders, floored at ms clock). */
export function nextNonce(owner: string): bigint {
  const key = `perpify_nonce_${owner.toLowerCase()}`;
  let last = 0;
  try {
    last = Number(localStorage.getItem(key) || "0") || 0;
  } catch {
    /* private mode */
  }
  const n = Math.max(last + 1, Date.now());
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
  return BigInt(n);
}

/** True iff an injected wallet is present to sign with. */
export function hasInjectedSigner(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
}

/**
 * Sign a canonical order with the connected wallet. Returns the 0x signature. Throws if there
 * is no injected wallet or the user rejects the signature request.
 */
export async function signOrder(o: CanonicalOrder): Promise<`0x${string}`> {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth) throw new Error("no injected wallet to sign with");
  const client = createWalletClient({ transport: custom(eth as never) });
  return client.signTypedData({
    account: getAddress(o.owner),
    domain: PERPIFY_EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      owner: getAddress(o.owner),
      market: o.market,
      side: o.side,
      qty: o.qty8,
      price: o.price8,
      tif: o.tif,
      reduceOnly: o.reduceOnly,
      nonce: o.nonce,
      expiry: o.expiry,
    },
  });
}

/** The wire payload the engine's `place_order_signed` handler expects (all ints as strings). */
export function toWirePayload(o: CanonicalOrder, signature: string, id: string) {
  return {
    type: "place_order_signed",
    id,
    owner: getAddress(o.owner),
    symbol: o.market,
    market: o.market,
    side: o.side,
    qty8: o.qty8.toString(),
    price8: o.price8.toString(),
    tif: o.tif,
    reduceOnly: o.reduceOnly,
    nonce: o.nonce.toString(),
    expiry: o.expiry.toString(),
    signature,
  };
}
