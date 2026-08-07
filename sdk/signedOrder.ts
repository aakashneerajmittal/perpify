/**
 * EIP-712 signed orders — how agents authenticate on Perpify: by wallet, exactly like humans
 * (decision Aug 7). Reuses the engine's own canonicalization (orderFields) and typed-data
 * signer (signOrder) so the payload this builds is byte-identical to what the engine verifies
 * (engine/src/auth/eip712.ts). The private key is used ONLY to sign locally — it is never placed
 * in the message, transmitted to the venue, or logged; only the signature and public address go
 * on the wire, and the engine binds the recovered signer to the connection owner.
 */
import { Wallet } from "ethers";
import { orderFields, signOrder } from "../engine/src/auth/eip712.js";

export interface SignedOrderInput {
  market: string;
  side: "buy" | "sell";
  qty8: bigint | string | number; // 1e8 fixed-point integer
  price8: bigint | string | number; // 1e8 fixed-point integer
  tif?: "GTC" | "IOC" | "POST_ONLY";
  reduceOnly?: boolean;
  nonce: bigint | string | number; // monotonic per wallet (the engine's replay guard)
  expiry?: bigint | string | number; // 0 = good-till-cancel
  id?: string;
}

/** The connection owner / signer address for a private key. */
export function addressOf(privateKey: string): string {
  return new Wallet(privateKey).address;
}

/** Build a `place_order_signed` wire message, EIP-712-signed with the given key. */
export async function buildSignedOrder(privateKey: string, o: SignedOrderInput): Promise<Record<string, unknown>> {
  const wallet = new Wallet(privateKey);
  const fields = orderFields({
    owner: wallet.address,
    market: o.market,
    side: o.side,
    qty8: o.qty8,
    price8: o.price8,
    tif: o.tif ?? "GTC",
    reduceOnly: !!o.reduceOnly,
    nonce: o.nonce,
    expiry: o.expiry ?? 0,
  });
  const signature = await signOrder(wallet, fields);
  return {
    type: "place_order_signed",
    id: o.id,
    owner: fields.owner,
    market: o.market,
    symbol: o.market,
    side: fields.side,
    qty8: fields.qty,
    price8: fields.price,
    tif: fields.tif,
    reduceOnly: fields.reduceOnly,
    nonce: fields.nonce,
    expiry: fields.expiry,
    signature,
  };
}
