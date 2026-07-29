/**
 * Post the current gap reading + register the model artifact hash on Base Sepolia.
 * Run after risk/gap/publish.py:  npx tsx post-reading.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = JSON.parse(readFileSync(join(here, "build.json"), "utf8"));
const deployment = JSON.parse(readFileSync(join(here, "..", "deployments", "base-sepolia.json"), "utf8"));
const reading = JSON.parse(
  readFileSync(join(here, "..", "..", "risk", "gap", "out", "reading-current.json"), "utf8"),
);

const env: Record<string, string> = {};
for (const line of readFileSync(join(here, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.trim();
}

const SESSION_ENUM: Record<string, number> = { open: 0, weeknight: 1, weekend: 2, holiday: 3 };

async function main() {
  const provider = new JsonRpcProvider(env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const wallet = new Wallet(env.PRIVATE_KEY!, provider);
  const registry = new Contract(deployment.contracts.RiskRegistry, artifacts.RiskRegistry.abi, wallet);

  const coeff1e6 = Math.round(reading.gapCoefficient * 1e6);
  const session = SESSION_ENUM[reading.session];
  const hoursDark10 = Math.round(reading.hoursDarkRemaining * 10);

  const tx1 = await registry.postGapReading(coeff1e6, session, hoursDark10, reading.modelVersion);
  await tx1.wait();
  console.log(`postGapReading(${coeff1e6}, ${session}, ${hoursDark10}, "${reading.modelVersion}") → ${tx1.hash}`);

  const key = `gap@${reading.modelVersion.replace("gap-", "")}`;
  const tx2 = await registry.registerModel(key, reading.artifactHash);
  await tx2.wait();
  console.log(`registerModel("${key}", ${reading.artifactHash}) → ${tx2.hash}`);

  const g = await registry.latestGap();
  console.log(`\non-chain latestGap: coefficient=${Number(g[0]) / 1e6} session=${g[1]} hoursDark10=${g[2]} model="${g[4]}"`);
  const h = await registry.modelArtifact(key);
  console.log(`on-chain modelArtifact["${key}"] = ${h}`);
}

main().catch((e) => {
  console.error("POST FAILED:", e?.message ?? e);
  process.exit(1);
});
