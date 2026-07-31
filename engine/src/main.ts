/**
 * The Perpify venue service — everything alive in one process:
 *   EngineBus (pure core) · WireServer (Density-dialect ws) · maker + taker bots ·
 *   testnet price loop · risk-reading refresh · daily epoch settlement · command-log
 *   persistence with replay-on-boot (the venue can die and resume mid-day, replayable).
 *
 * Run modes:
 *   npm run venue                      — live mode (chain posts on, python risk refresh)
 *   npm run venue -- --offline         — no chain calls (local dev/soak)
 *   npm run venue -- --soak=60         — run N seconds, assert invariants, exit 0/1
 *
 * Weekend-run instructions: docs/OPERATIONS.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EngineBus } from "./wire/bus.js";
import { WireServer } from "./wire/server.js";
import { MakerBot, DEFAULT_MAKER } from "./bots/maker.js";
import { TakerBot } from "./bots/taker.js";
import { ChainClient } from "./chain.js";
import { checkConservation, stateRoot } from "./state.js";
import { px8 as toPx8 } from "./fixed.js";
import type { Command } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"] as const;
  }),
);
const OFFLINE = args.has("offline");
const SOAK_S = args.has("soak") ? Number(args.get("soak")) : 0;
const PORT = Number(args.get("port") ?? 8787);

const MAKER_ADDR = "0x3a4ke00000000000000000000000000000000009";
const TAKERS = [
  { owner: "0x7a4e100000000000000000000000000000000011", seed: 11, longBias: 0.55 },
  { owner: "0x7a4e200000000000000000000000000000000012", seed: 22, longBias: 0.45 },
  { owner: "0x7a4e300000000000000000000000000000000013", seed: 33, longBias: 0.5 },
];

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

// ---------- service ----------

async function main() {
  const bus = new EngineBus();
  const dispatch = (cmd: Command) => {
    persist(cmd);
    return bus.dispatch(cmd);
  };

  const replayed = replayBootLog(bus);
  console.log(`[boot] venue service · replayed ${replayed} commands from today's log · port ${PORT}`);

  const chain = OFFLINE ? null : ChainClient.fromRepo(repoRoot);

  // seed price: last dataset close ×10 (testnet SPX proxy), then a slow OU wiggle so
  // the book breathes — synthetic microstructure, clearly labeled, testnet only
  const lines = readFileSync(join(repoRoot, "risk", "data", "spy_daily.csv"), "utf8").trim().split("\n");
  let price = Number(lines[lines.length - 1]!.split(",")[4]) * 10;
  const anchor = price;
  let wiggleSeed = 20260729;
  const wrng = () => {
    wiggleSeed = (Math.imul(1103515245, wiggleSeed) + 12345) >>> 0;
    return wiggleSeed / 4294967296;
  };

  if (bus.state.indexPx8 === 0n) dispatch({ kind: "OracleTick", market: "SPX-PERP", indexPx: toPx8(price), source: "testnet-feed" });

  // risk reading from the published file (refreshed on interval below)
  const applyRiskReading = () => {
    const p = join(repoRoot, "risk", "gap", "out", "reading-current.json");
    if (!existsSync(p)) return;
    const r = JSON.parse(readFileSync(p, "utf8"));
    dispatch({
      kind: "RiskReading",
      reading: {
        kind: "gap",
        market: "SPX-PERP",
        gapCoefficient: r.gapCoefficient,
        session: r.session === "open" ? "open" : r.darkType === "extended" ? "weekend" : "weeknight",
        hoursDark: r.hoursDarkRemaining,
        expectedGapStd: 0,
        modelVersion: r.modelVersion,
        signature: "0xservice",
      },
    });
  };

  // bots (they dispatch through the persisting wrapper so every action is replayable)
  const botBus = { dispatch, state: bus.state };
  const maker = new MakerBot(botBus, { owner: MAKER_ADDR, ...DEFAULT_MAKER });
  // engine-side testnet funding exactly once (replay-safe: replayed deposits already credited)
  const funded = bus.state.accounts.get(MAKER_ADDR)?.free ?? 0n;
  const takers = TAKERS.map(
    (t) =>
      new TakerBot(botBus, {
        owner: t.owner,
        seed: t.seed,
        maxQty: 0.6,
        aggressionBps: 25,
        tradeEveryMs: 3000,
        longBias: t.longBias,
      }),
  );
  if (funded === 0n) {
    maker.fund(1_000_000);
    for (const t of takers) t.fund(50_000);
  }

  const server = new WireServer(bus, { port: PORT, bookIntervalMs: 500, priceIntervalMs: 1000 });
  const boundPort = await server.listen();
  console.log(`[boot] ws endpoints live on :${boundPort} (order-and-account-updates · order-book · marketDataStream)`);

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

  // price wiggle + engine tick (2s); hourly post to chain in live mode
  every(2000, () => {
    price = price + (anchor - price) * 0.02 + anchor * (wrng() - 0.5) * 0.0004;
    dispatch({ kind: "OracleTick", market: "SPX-PERP", indexPx: toPx8(Math.round(price * 100) / 100), source: "testnet-feed" });
  });
  if (chain) every(3_600_000, () => void chain.postOraclePrice(BigInt(Math.round(price * 1e8))).catch((e) => console.error("[chain]", e.message)));

  // maker requote (2s) and taker flow (3s, staggered)
  every(DEFAULT_MAKER.requoteMs, () => maker.requote());
  takers.forEach((t, i) => every(3000 + i * 700, () => t.step()));

  // funding hourly; risk refresh every 15 min. The publisher is LOCAL computation
  // (no chain), so it runs in offline mode too — this is what makes the coefficient
  // rise into the weekend whether or not we're posting to chain.
  const refreshReading = () => {
    const r = spawnSync("python3", [join(repoRoot, "risk", "gap", "publish.py")], { timeout: 120_000 });
    if (r.status !== 0) console.error("[risk] publish.py failed; holding last reading", r.stderr?.toString().slice(0, 200));
    applyRiskReading();
  };
  refreshReading(); // fresh at boot
  every(3_600_000, () => dispatch({ kind: "FundingTick", market: "SPX-PERP" }));
  every(900_000, refreshReading);

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
    const book = bus.bookSnapshot(1, 2);
    console.log(
      `[hb] seq=${bus.state.seq} mark=${(Number(bus.state.markPx8) / 1e8).toFixed(2)} ` +
        `coeff=${(Number(bus.state.gapCoeff6) / 1e6).toFixed(3)} bid=${book.b[0]?.P ?? "-"} ask=${book.a[0]?.P ?? "-"} ` +
        `conservation=${c.holds ? "OK" : "BROKEN"}`,
    );
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
      // force activity flush, then final asserts
      maker.requote();
      const c = checkConservation(bus.state);
      const book = bus.bookSnapshot(5, 2);
      const trades = bus.state.eventCount;
      const ok = c.holds && book.b.length > 0 && book.a.length > 0 && trades > 20;
      console.log(
        `[soak] ${SOAK_S}s done · events=${trades} · book ${book.b.length}x${book.a.length} · ` +
          `spread ${book.b[0]?.P}/${book.a[0]?.P} · conservation=${c.holds ? "OK" : "BROKEN"} → ${ok ? "PASS" : "FAIL"}`,
      );
      await shutdown(ok ? 0 : 1);
    }, SOAK_S * 1000);
  }
}

main().catch((e) => {
  console.error("VENUE FAILED:", e?.message ?? e);
  process.exit(1);
});
