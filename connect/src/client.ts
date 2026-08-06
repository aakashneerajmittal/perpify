/**
 * Read-only trade-history fetch. Each exchange's account-trade endpoint is paginated differently;
 * this walks them into the canonical `Fill[]` via the normalizers.
 *
 * The network is injected as a `Transport` so the whole thing is unit-testable with fixture pages
 * (and so the security property — the API secret never appears in a URL or header — is verifiable).
 * `now` is injected too, so signed requests are deterministic under test. The real transport
 * (`fetchTransport`) is a thin `fetch` wrapper.
 *
 * Read-only by design: only account-trade *reads* are issued; nothing here can place, cancel, or
 * withdraw. Users are expected to mint keys with trade/withdraw permissions disabled.
 */
import type { Exchange, Fill } from "./types.js";
import { normalizeBinance, normalizeBybit, normalizeOkx } from "./normalizers.js";
import { okxTimestamp, signBinanceQuery, signBybit, signOkx } from "./sign.js";

export interface Creds {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // OKX only
}

export interface HttpRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}
export interface HttpResponse {
  status: number;
  json: any;
}
export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export interface FetchOpts {
  transport: Transport;
  now?: () => number;
  symbols?: string[]; // Binance requires this (userTrades is per-symbol); optional filter elsewhere
  category?: string; // Bybit: "linear" (default) | "spot" | "inverse"
  instType?: string; // OKX: "SWAP" (default) | "SPOT" | "MARGIN" | "FUTURES"
  limit?: number; // page size (default 100)
  maxPages?: number; // safety cap per stream (default 50)
  recvWindow?: string; // Binance/Bybit (default "5000")
}

const BASE: Record<Exchange, string> = {
  binance: "https://fapi.binance.com",
  bybit: "https://api.bybit.com",
  okx: "https://www.okx.com",
};

const DEFAULTS = { limit: 100, maxPages: 50, recvWindow: "5000" };

/** Real transport: a thin fetch wrapper. Not unit-tested (network); the logic above is. */
export const fetchTransport: Transport = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

/** Fetch + normalize a wallet's trade history into canonical fills. */
export async function fetchTradeHistory(exchange: Exchange, creds: Creds, opts: FetchOpts): Promise<Fill[]> {
  switch (exchange) {
    case "binance":
      return fetchBinance(creds, opts);
    case "bybit":
      return fetchBybit(creds, opts);
    case "okx":
      return fetchOkx(creds, opts);
    default:
      throw new Error(`unknown exchange: ${exchange}`);
  }
}

async function fetchBinance(creds: Creds, opts: FetchOpts): Promise<Fill[]> {
  const now = opts.now ?? Date.now;
  const limit = opts.limit ?? DEFAULTS.limit;
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const recvWindow = opts.recvWindow ?? DEFAULTS.recvWindow;
  const symbols = opts.symbols;
  if (!symbols || symbols.length === 0) {
    throw new Error("binance userTrades is per-symbol: pass opts.symbols (e.g. ['BTCUSDT'])");
  }
  const out: Fill[] = [];
  for (const symbol of symbols) {
    let fromId: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ symbol, limit: String(limit), recvWindow, timestamp: String(now()) });
      if (fromId !== undefined) params.set("fromId", String(fromId));
      const qs = params.toString();
      const sig = signBinanceQuery(creds.apiSecret, qs);
      const url = `${BASE.binance}/fapi/v1/userTrades?${qs}&signature=${sig}`;
      const res = await opts.transport({ method: "GET", url, headers: { "X-MBX-APIKEY": creds.apiKey } });
      const rows: any[] = Array.isArray(res.json) ? res.json : [];
      out.push(...normalizeBinance(rows));
      if (rows.length < limit) break;
      const lastId = Math.max(...rows.map((r) => Number(r.id)).filter((n) => isFinite(n)));
      if (!isFinite(lastId)) break;
      fromId = lastId + 1;
    }
  }
  return out;
}

async function fetchBybit(creds: Creds, opts: FetchOpts): Promise<Fill[]> {
  const now = opts.now ?? Date.now;
  const limit = opts.limit ?? DEFAULTS.limit;
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const recvWindow = opts.recvWindow ?? DEFAULTS.recvWindow;
  const category = opts.category ?? "linear";
  const out: Fill[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ category, limit: String(limit) });
    if (opts.symbols?.[0]) params.set("symbol", opts.symbols[0]);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    const timestamp = String(now());
    const sig = signBybit(creds.apiSecret, { timestamp, apiKey: creds.apiKey, recvWindow, payload: qs });
    const url = `${BASE.bybit}/v5/execution/list?${qs}`;
    const res = await opts.transport({
      method: "GET",
      url,
      headers: {
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "X-BAPI-SIGN": sig,
      },
    });
    out.push(...normalizeBybit(res.json));
    const next = res.json?.result?.nextPageCursor;
    const list: any[] = res.json?.result?.list ?? [];
    if (!next || list.length === 0) break;
    cursor = next;
  }
  return out;
}

async function fetchOkx(creds: Creds, opts: FetchOpts): Promise<Fill[]> {
  const now = opts.now ?? Date.now;
  const limit = opts.limit ?? DEFAULTS.limit;
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const instType = opts.instType ?? "SWAP";
  const out: Fill[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ instType, limit: String(limit) });
    if (after) params.set("after", after);
    const requestPath = `/api/v5/trade/fills?${params.toString()}`;
    const timestamp = okxTimestamp(now());
    const sig = signOkx(creds.apiSecret, { timestamp, method: "GET", requestPath, body: "" });
    const url = `${BASE.okx}${requestPath}`;
    const res = await opts.transport({
      method: "GET",
      url,
      headers: {
        "OK-ACCESS-KEY": creds.apiKey,
        "OK-ACCESS-SIGN": sig,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": creds.passphrase ?? "",
      },
    });
    out.push(...normalizeOkx(res.json));
    const data: any[] = res.json?.data ?? [];
    if (data.length < limit) break;
    const last = data[data.length - 1];
    after = last?.billId;
    if (!after) break;
  }
  return out;
}
