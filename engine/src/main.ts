/**
 * The Perpify venue service — everything alive in one process:
 *   EngineBus (pure multi-market core) · WireServer (Density-dialect ws) · per-market maker +
 *   taker bots · per-market testnet price loops · risk-reading refresh · daily epoch
 *   settlement · command-log persistence with replay-on-boot (the venue can die and resume
 *   mid-day, replayable).
 *
 * Markets: SPX-PERP (S&P 500 index perp, flagship) + NVDA / AAPL / MSFT / GOOGL / AMZN
 * single-stock perps (the five largest US companies by market cap). One shared collateral
 * balance per trader; each market has its own book / oracle / mark / gap coefficient.
 *
 * Run modes:
 *   npm run venue                      — live mode (chain posts on)
 *   npm run venue -- --offline         — no chain calls (local dev/soak)
 *   npm run venue -- --soak=60         — run N seconds, assert invariants, exit 0/1
 *
 * Weekend-run instructions: docs/OPERATIONS.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EngineBus } from "./wire/bus.js";
import { WireServer } from "./wire/server.js";
import { MakerBot, DEFAULT_MAKER } from "./bots/maker.js";
import { TakerBot } from "./bots/taker.js";
import { ChainClient } from "./chain.js";
import { checkConservation, stateRoot, MARKET_IDS } from "./state.js";
import { px8 as toPx8 } from "./fixed.js";
import { computeGapReading, gapScaleFor } from "./risk/gapCoefficient.js";
import type { Command, MarketId } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"] as const;
  }),
);
const OFFLINE = args.has("offline");
const DEMO = args.has("demo"); // investor demo: browsers that connect get testnet funds + a tier
const FRESH = args.has("fresh"); // skip replaying today's command log — clean two-sided maker book
const SOAK_S = args.has("soak") ? Number(args.get("soak")) : 0;
const PORT = Number(args.get("port") ?? process.env.PORT ?? 8787);
const ORIGINS = (args.get("origins") ?? process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,null")
  .split(",")
  .map((s) => s.trim());

/**
 * Per-market seed prices for the synthetic testnet feed. SPX is derived from the dataset
 * (last SPY close ×10); the single-stock anchors are plausible 2026 levels — clearly
 * labelled testnet, purely to make the tape realistic (the venue prices risk, not the
 * underlying). A slow OU wiggle around each anchor makes the books breathe.
 */
const STOCK_ANCHORS: Record<Exclude<MarketId, "SPX-PERP">, number> = {
  "NVDA-PERP": 182.5,
  "AAPL-PERP": 236.0,
  "MSFT-PERP": 512.0,
  "GOOGL-PERP": 205.0,
  "AMZN-PERP": 236.0,
};

/** deterministic, valid 0x+40hex bot address, unique per (kind, marketIdx, slot) */
function botAddr(kind: number, marketIdx: number, slot = 0): string {
  return "0x" + (kind * 100000 + marketIdx * 100 + slot).toString(16).padStart(40, "0");
}

// ---------- command-log persistence (replay-on-boot) ----------

const logDir = join(repoRoot, "engine", "logs");
mkdirSync(logDir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const cmdLogPath = join(logDir, `commands-${day}.jsonl`);

const bigintJson = (_k: string, v: unknown) => (typeof v === "bigint" ? `bi:${v.toString()}` : v);
const bigintParse = (_k: string, v: unknown) =>
  typeof v === "string" && v.startsWith("bi:") ? BigInt(v.slice(3)) : v;

function persist(cmd: Command): void {
  appendFileSync(cmdLogPath, JSON.stringify(cmd, bigintJson) + "\n");
}

function replayBootLog(bus: EngineBus): number {
  if (!existsSync(cmdLogPath)) return 0;
  const lines = readFileSync(cmdLogPath, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) bus.dispatch(JSON.parse(line, bigintParse) as Command);
  return lines.length;
}

// ---------- per-market runtime ----------

interface MarketRuntime {
  id: MarketId;
  price: number;
  anchor: number;
  wiggleSeed: number;
  maker: MakerBot;
  takers: TakerBot[];
}

// ---------- service ----------

async function main() {
  const bus = new EngineBus();
  const dispatch = (cmd: Command) => {
    persist(cmd);
    return bus.dispatch(cmd);
  };

  const replayed = FRESH ? 0 : replayBootLog(bus);
  console.log(`[boot] venue service · ${FRESH ? "fresh start (log replay skipped)" : `replayed ${replayed} commands from today's log`} · port ${PORT} · ${MARKET_IDS.length} markets`);

  // On-chain settlement (Base Sepolia) is env-gated and crash-safe: with --offline, or if the
  // operator secrets aren't present, the venue runs fully off-chain (reliable demo default).
  // To turn it on for the live demo: set BASE_SEPOLIA_RPC_URL + PRIVATE_KEY and drop --offline.
  let chain: ChainClient | null = null;
  if (!OFFLINE) {
    try {
      chain = ChainClient.fromRepo(repoRoot);
      console.log("[boot] chain: Base Sepolia settlement ON (operator key loaded)");
    } catch (e) {
      console.warn(`[boot] chain OFF — ${(e as Error).message}; running off-chain`);
    }
  }

  // SPX seed: last dataset close ×10 (testnet SPX proxy)
  const spyLines = readFileSync(join(repoRoot, "risk", "data", "spy_daily.csv"), "utf8").trim().split("\n");
  const spxAnchor = Number(spyLines[spyLines.length - 1]!.split(",")[4]) * 10;

  const anchorFor = (id: MarketId): number => (id === "SPX-PERP" ? spxAnchor : STOCK_ANCHORS[id]);

  const botBus = { dispatch, state: bus.state };

  // build a runtime per market: seed the oracle, then a maker + a few takers
  const runtimes: MarketRuntime[] = MARKET_IDS.map((id, i) => {
    const anchor = anchorFor(id);
    // seed the oracle so the market is "open" before bots quote
    if (bus.state.markets.get(id)!.indexPx8 === 0n) {
      dispatch({ kind: "OracleTick", market: id, indexPx: toPx8(Math.round(anchor * 100) / 100), source: "testnet-feed" });
    }
    const makerAddr = botAddr(1, i);
    const maker = new MakerBot(botBus, { owner: makerAddr, market: id, ...DEFAULT_MAKER });
    const takers = [
      { slot: 0, seed: 11 + i, longBias: 0.55 },
      { slot: 1, seed: 22 + i, longBias: 0.45 },
      { slot: 2, seed: 33 + i, longBias: 0.5 },
    ].map(
      (t) =>
        new TakerBot(botBus, {
          owner: botAddr(2, i, t.slot),
          market: id,
          seed: t.seed,
          maxQty: 0.6,
          aggressionBps: 25,
          tradeEveryMs: 3000,
          longBias: t.longBias,
        }),
    );
    // engine-side testnet funding exactly once (replay-safe: replayed deposits already credited)
    if ((bus.state.accounts.get(makerAddr)?.free ?? 0n) === 0n) {
      maker.fund(1_000_000);
      for (const t of takers) t.fund(50_000);
    }
    return { id, price: anchor, anchor, wiggleSeed: 20260729 + i * 7919, maker, takers };
  });

  const server = new WireServer(bus, {
    port: PORT,
    bookIntervalMs: 500,
    priceIntervalMs: 1000,
    dispatch, // browser orders go through the persisting wrapper → logged + replayable
    allowedOrigins: ORIGINS,
    demo: DEMO ? { fundUsd: 100_000, tier: "B", tierMult: 0.9 } : undefined,
  });
  const boundPort = await server.listen();
  console.log(
    `[boot] ws endpoints live on :${boundPort} (order-and-account-updates · order-book · marketDataStream)` +
      (DEMO ? " · DEMO mode: browsers auto-funded $100k (cross), tier by wallet" : ""),
  );

  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, fn: () => void) => {
    const t = setInterval(() => {
      try {
        fn();
      } catch (e) {
        console.error("[loop-error]", (e as Error).message);
      }
    }, ms);
    timers.push(t);
  };

  // per-market price wiggle + engine tick (2s). Each market has its own OU process around
  // its anchor so the six tapes move independently.
  for (const rt of runtimes) {
    const wrng = () => {
      rt.wiggleSeed = (Math.imul(1103515245, rt.wiggleSeed) + 12345) >>> 0;
      return rt.wiggleSeed / 4294967296;
    };
    every(2000, () => {
      rt.price = rt.price + (rt.anchor - rt.price) * 0.02 + rt.anchor * (wrng() - 0.5) * 0.0004;
      dispatch({ kind: "OracleTick", market: rt.id, indexPx: toPx8(Math.round(rt.price * 100) / 100), source: "testnet-feed" });
    });
    // maker requote (2s) and taker flow (3s, staggered per market + per taker)
    every(DEFAULT_MAKER.requoteMs, () => rt.maker.requote());
    rt.takers.forEach((t, ti) => every(3000 + ti * 700, () => t.step()));
  }

  // hourly chain post of the flagship price in live mode
  if (chain) {
    every(3_600_000, () => {
      const spx = runtimes.find((r) => r.id === "SPX-PERP")!;
      void chain.postOraclePrice(BigInt(Math.round(spx.price * 1e8))).catch((e) => console.error("[chain]", e.message));
    });
  }

  // Gap coefficient computed live in-process from the real US-equity market clock
  // (risk/gap/model.py ported to TS). All markets share the US session clock, so one
  // reading drives every market — each gets its own signed RiskReading so per-market
  // margin, maker spread and the header all glide into the dark together. A market pinned
  // by the demo-weekend toggle is skipped so its override holds.
  const refreshReadings = () => {
    for (const id of MARKET_IDS) {
      if (server.demoWeekendMarkets.has(id)) continue;
      // per-symbol dark premium: single stocks gap wider than the index (vol-scaled v0)
      const g = computeGapReading(new Date(), "normal", gapScaleFor(id));
      dispatch({
        kind: "RiskReading",
        reading: {
          kind: "gap",
          market: id,
          gapCoefficient: g.gapCoefficient,
          session: g.session,
          hoursDark: g.hoursDarkRemaining,
          expectedGapStd: 0,
          modelVersion: g.modelVersion,
          signature: "0xservice",
        },
      });
    }
  };
  refreshReadings(); // fresh at boot
  every(60_000, refreshReadings); // re-sign the glide every minute
  every(3_600_000, () => {
    for (const id of MARKET_IDS) dispatch({ kind: "FundingTick", market: id });
  });

  // oracle confidence per market (testnet proxy): high while the synthetic feed is fresh;
  // a demo control drops it below threshold → reduce-only (new exposure blocked, closes allowed).
  const refreshConfidence = () => {
    for (const id of MARKET_IDS) {
      const forced = server.demoReduceOnlyMarkets.has(id);
      dispatch({
        kind: "RiskReading",
        reading: {
          kind: "confidence",
          market: id,
          confidence: forced ? 0.35 : 0.96,
          dispersionBps: forced ? 40 : 3,
          stalenessMs: 200,
          reduceOnly: forced,
          signature: "0xservice",
        },
      });
    }
  };
  refreshConfidence(); // fresh at boot
  every(30_000, refreshConfidence);

  // daily epoch settlement in live mode
  if (chain) {
    every(86_400_000, async () => {
      const epochId = (await chain.lastEpochId()) + 1;
      dispatch({ kind: "EpochClose", epochId });
      const root = stateRoot(bus.state);
      const tx = await chain.settleEpoch(epochId, root, bus.state.eventHead, bus.state.seq, []);
      console.log(`[epoch] ${epochId} settled ${tx}`);
    });
  }

  // heartbeat + invariant watchdog (every 30s): a venue that would rather die than lie
  every(30_000, () => {
    const c = checkConservation(bus.state);
    const marks = MARKET_IDS.map((id) => {
      const m = bus.state.markets.get(id)!;
      return `${id.replace("-PERP", "")}=${(Number(m.markPx8) / 1e8).toFixed(2)}`;
    }).join(" ");
    console.log(`[hb] seq=${bus.state.seq} ${marks} conservation=${c.holds ? "OK" : "BROKEN"}`);
    if (!c.holds) {
      console.error(`[fatal] conservation drift ${c.driftAbs} — halting venue`);
      process.exit(1);
    }
  });

  const shutdown = async (code: number) => {
    for (const t of timers) clearInterval(t);
    await server.close();
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  if (SOAK_S > 0) {
    setTimeout(async () => {
      // force activity flush across every market, then final asserts
      for (const rt of runtimes) rt.maker.requote();
      const c = checkConservation(bus.state);
      let booksOk = true;
      for (const id of MARKET_IDS) {
        const b = bus.bookSnapshot(id, 5, 2);
        if (b.b.length === 0 || b.a.length === 0) booksOk = false;
      }
      const trades = bus.state.eventCount;
      const ok = c.holds && booksOk && trades > 20;
      console.log(
        `[soak] ${SOAK_S}s done · events=${trades} · booksTwoSided=${booksOk} · conservation=${c.holds ? "OK" : "BROKEN"} → ${ok ? "PASS" : "FAIL"}`,
      );
      await shutdown(ok ? 0 : 1);
    }, SOAK_S * 1000);
  }
}

main().catch((e) => {
  console.error("VENUE FAILED:", e?.message ?? e);
  process.exit(1);
});
