/**
 * Item-5 service cycle: one full engine ↔ chain round trip, no human-entered values.
 *
 *   chain → engine : real Deposited events become engine Deposit commands
 *   chain → engine : the on-chain oracle price becomes the engine's OracleTick
 *   risk  → engine : the current published gap reading becomes a RiskReading command
 *   engine → chain : the epoch closes; state root + event-chain head post to Settlement
 *
 * Exits non-zero if any step fails or the posted root doesn't read back identically.
 * Run: npm run epoch-cycle   (cron-able; see docs/OPERATIONS.md)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { apply } from "./core.js";
import { fmtUsd, px8 } from "./fixed.js";
import { checkConservation, createEngine, stateRoot } from "./state.js";
import { ChainClient } from "./chain.js";
import type { Command } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function lastDatasetClose(): number {
  const lines = readFileSync(join(repoRoot, "risk", "data", "spy_daily.csv"), "utf8").trim().split("\n");
  const close = Number(lines[lines.length - 1]!.split(",")[4]);
  if (!Number.isFinite(close) || close <= 0) throw new Error("bad dataset close");
  return close;
}

async function main() {
  const chain = ChainClient.fromRepo(repoRoot);
  const me = await chain.operatorAddress();
  console.log(`epoch-cycle service · operator ${me}\n`);

  // 1) ops leg: post a fresh testnet-feed price (SPX proxy = latest dataset SPY close × 10)
  const spxProxy = Math.round(lastDatasetClose() * 10 * 1e8);
  const priceTx = await chain.postOraclePrice(BigInt(spxProxy));
  console.log(`[ops]    posted oracle price ${spxProxy / 1e8} (testnet-feed proxy) tx ${priceTx}`);

  // 2) chain → engine: deposits
  const deposits = await chain.ensureDemoDeposit(1_000_000_000n); // $1,000 if none exist yet
  console.log(`[ingest] ${deposits.length} Deposited event(s) found on the vault`);

  // 3) risk → engine: current published reading (produced by risk/gap/publish.py)
  const reading = JSON.parse(
    readFileSync(join(repoRoot, "risk", "gap", "out", "reading-current.json"), "utf8"),
  );
  console.log(`[risk]   gap reading: coeff ${reading.gapCoefficient} (${reading.session}, ${reading.modelVersion})`);

  // 4) deterministic core replays reality as a command log
  const s = createEngine();
  const cmds: Command[] = [
    ...deposits.map(
      (d): Command => ({ kind: "Deposit", owner: d.owner, amount: d.amount6, l1TxHash: d.txHash }),
    ),
    {
      kind: "OracleTick",
      market: "SPX-PERP",
      indexPx: BigInt((await chain.readOracleRaw()).price1e8),
      source: "testnet-feed",
    },
    {
      kind: "RiskReading",
      reading: {
        kind: "gap",
        market: "SPX-PERP",
        gapCoefficient: reading.gapCoefficient,
        session: reading.session === "open" ? "open" : reading.darkType === "extended" ? "weekend" : "weeknight",
        hoursDark: reading.hoursDarkRemaining,
        expectedGapStd: 0,
        modelVersion: reading.modelVersion,
        signature: "0xservice",
      },
    },
    { kind: "FundingTick", market: "SPX-PERP" },
  ];
  const epochId = (await chain.lastEpochId()) + 1;
  cmds.push({ kind: "EpochClose", epochId });
  for (const c of cmds) apply(s, c);

  const cons = checkConservation(s);
  const root = stateRoot(s);
  console.log(`[engine] ${cmds.length} commands applied · deposits credited ${fmtUsd(s.totalDeposited6)} · conservation ${cons.holds ? "HOLDS" : "BROKEN"}`);
  if (!cons.holds) throw new Error("conservation broken — refusing to settle");

  // 5) engine → chain: settle the epoch
  const txHash = await chain.settleEpoch(epochId, root, s.eventHead, s.seq, []);
  console.log(`[settle] epoch ${epochId} posted · tx ${txHash}`);

  // 6) verify the chain holds exactly what the engine computed
  const onchain = await chain.readEpoch(epochId);
  const ok = onchain.stateRoot === root && onchain.eventChainHead === s.eventHead;
  console.log(`[verify] on-chain stateRoot ${ok ? "MATCHES engine root ✓" : "MISMATCH ✗"}`);
  console.log(`         root ${root.slice(0, 34)}… · eventHead ${s.eventHead.slice(0, 34)}…`);
  if (!ok) process.exit(1);
  console.log("\nepoch-cycle complete: chain→engine→chain round trip verified.");
}

main().catch((e) => {
  console.error("EPOCH-CYCLE FAILED:", e?.message ?? e);
  process.exit(1);
});
