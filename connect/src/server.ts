/**
 * The connect server surface. `runConnect` is the pure-ish core (network injected) so it's
 * unit-testable; `createConnectHandler` is the thin node:http wrapper around it.
 *
 * SECURITY: credentials are used only to sign read-only reads and are never logged or echoed back.
 * The response contains reconstructed round-trips + a summary — never the key/secret. This is the
 * "only server surface" for the connect; scoring + the verified-tier hand-off layer on top (P2.3).
 */
import http from "node:http";
import type { Exchange, RoundTrip } from "./types.js";
import { reconstruct, setEquity } from "./reconstruct.js";
import { fetchTradeHistory, fetchTransport, type Creds, type Transport } from "./client.js";
import { scoreTrader, toTierReading, type ScoredTrader } from "./score.js";
import { signTierAttestation } from "./attest.js";

export interface ConnectInput {
  exchange: Exchange;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  symbols?: string[];
  account0?: number; // starting account value for equity drift (else estimated from peak notional)
  wallet?: string; // if present, a verified-tier reading for this wallet is produced for hand-off
}

export interface ConnectSummary {
  trades: number;
  roundTrips: number;
  symbols: string[];
  winRate: number;
  netPnl: number;
  spanDays: number;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
  summary?: ConnectSummary;
  roundTrips?: RoundTrip[];
  scored?: ScoredTrader; // the Trader-DNA score/tier/archetype from the connected history
  tierReading?: ReturnType<typeof toTierReading>; // verified provisional tier for hand-off (if wallet given)
}

export interface ConnectDeps {
  transport: Transport;
  now?: () => number;
}

function summarize(rts: RoundTrip[]): ConnectSummary {
  const wins = rts.filter((r) => r.pnl > 0).length;
  const netPnl = rts.reduce((s, r) => s + r.pnl, 0);
  const span = rts.length ? rts[rts.length - 1]!.t + rts[rts.length - 1]!.hold : 0;
  return {
    trades: rts.length,
    roundTrips: rts.length,
    symbols: [...new Set(rts.map((r) => r.symbol))],
    winRate: rts.length ? wins / rts.length : 0,
    netPnl,
    spanDays: span,
  };
}

/** Peak concurrent deployed capital as a rough starting-account proxy when the user gives none. */
function estimateAccount(rts: RoundTrip[]): number {
  const peak = rts.reduce((m, r) => Math.max(m, r.notional), 0);
  return peak > 0 ? peak : 1;
}

/** Fetch a wallet's read-only history and reconstruct it into round-trips. Network is injected. */
export async function runConnect(input: ConnectInput, deps: ConnectDeps): Promise<ConnectResult> {
  if (!input || !input.exchange) return { ok: false, error: "missing exchange" };
  if (!input.apiKey || !input.apiSecret) return { ok: false, error: "missing read-only credentials" };
  const creds: Creds = { apiKey: input.apiKey, apiSecret: input.apiSecret, passphrase: input.passphrase };
  let fills;
  try {
    fills = await fetchTradeHistory(input.exchange, creds, {
      transport: deps.transport,
      now: deps.now,
      symbols: input.symbols,
    });
  } catch (e) {
    // never surface secrets in an error
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
  const rts = reconstruct(fills);
  setEquity(rts, input.account0 && input.account0 > 0 ? input.account0 : estimateAccount(rts));
  const scored = scoreTrader(rts);
  const tierReading = input.wallet ? toTierReading(input.wallet, scored) : undefined;
  // Mainnet attestation: sign the reading so the engine can verify it (decision 1). Testnet leaves
  // CONNECT_ATTEST_KEY unset → the reading keeps its stub signature and the engine trusts as sent.
  if (tierReading && process.env.CONNECT_ATTEST_KEY) {
    const issuedAt = deps.now ? deps.now() : Date.now();
    tierReading.issuedAt = issuedAt;
    tierReading.signature = await signTierAttestation(
      { wallet: tierReading.wallet, tier: tierReading.tier, tierMult: tierReading.tierMult, modelVersion: tierReading.modelVersion, issuedAt },
      process.env.CONNECT_ATTEST_KEY,
    );
  }
  return { ok: true, summary: summarize(rts), roundTrips: rts, scored, tierReading };
}

/** node:http handler for POST /connect/history. Body is JSON ConnectInput. Secrets never logged. */
export function createConnectHandler(deps?: Partial<ConnectDeps>) {
  const transport = deps?.transport ?? fetchTransport;
  const now = deps?.now;
  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (req.method === "GET" && req.url && req.url.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "perpify-connect" }));
      return;
    }
    if (req.method !== "POST" || !req.url || !req.url.startsWith("/connect/history")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy(); // cap payload
    });
    req.on("end", () => {
      let input: ConnectInput;
      try {
        input = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid json" }));
        return;
      }
      runConnect(input, { transport, now: now ?? Date.now })
        .then((result) => {
          res.writeHead(result.ok ? 200 : 400, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch(() => {
          // generic — never include the exception text (could echo request detail)
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "internal error" }));
        });
    });
  };
}

/** Boot the connect service. */
export function startConnectServer(port: number, deps?: Partial<ConnectDeps>): http.Server {
  return http.createServer(createConnectHandler(deps)).listen(port);
}
