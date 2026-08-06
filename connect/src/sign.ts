/**
 * Read-only request signing for each exchange's documented auth scheme.
 *
 * SECURITY: the API *secret* is only ever fed into an HMAC here — it is never placed in a URL,
 * a header, or a log. What goes on the wire is the derived signature plus the API *key* (an
 * identifier, not a secret). These functions are pure; the client builds the request around them.
 * Every scheme is anchored by a test vector (Binance uses its official published example).
 */
import { createHmac } from "node:crypto";

/** Binance (spot + USDⓈ-M futures): HMAC-SHA256 hex of the exact query string. Sent as
 *  `&signature=<hex>`; the key travels in the `X-MBX-APIKEY` header. */
export function signBinanceQuery(secret: string, queryString: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

/** Bybit v5: HMAC-SHA256 hex of `timestamp + apiKey + recvWindow + payload` (payload = the query
 *  string for GET). Sent in the `X-BAPI-SIGN` header alongside key/timestamp/recv-window headers. */
export function signBybit(
  secret: string,
  p: { timestamp: string; apiKey: string; recvWindow: string; payload: string },
): string {
  return createHmac("sha256", secret).update(p.timestamp + p.apiKey + p.recvWindow + p.payload).digest("hex");
}

/** OKX v5: base64( HMAC-SHA256( timestamp + method + requestPath + body ) ). timestamp is ISO-8601
 *  with milliseconds. Sent in `OK-ACCESS-SIGN` with key/timestamp/passphrase headers. */
export function signOkx(
  secret: string,
  p: { timestamp: string; method: string; requestPath: string; body: string },
): string {
  return createHmac("sha256", secret)
    .update(p.timestamp + p.method.toUpperCase() + p.requestPath + p.body)
    .digest("base64");
}

/** OKX requires an ISO-8601 millisecond timestamp, e.g. "2020-12-08T09:08:57.715Z". */
export function okxTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}
