/**
 * Deploy Perpify testnet V1 contracts to Base Sepolia over the public RPC.
 * Run: npx tsx deploy.ts
 * Reads ../.env (PRIVATE_KEY, BASE_SEPOLIA_RPC_URL), ./build.json (solc artifacts).
 * Writes ../deployments/base-sepolia.json + prints a markdown summary.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, formatEther } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts: Record<string, { abi: any; bytecode: string }> = JSON.parse(
  readFileSync(join(here, "build.json"), "utf8"),
);

// minimal .env parser (no dep)
const env: Record<string, string> = {};
for (const line of readFileSync(join(here, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.trim();
}

const RPC = env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const provider = new JsonRpcProvider(RPC);
const wallet = new NonceManager(new Wallet(env.PRIVATE_KEY!, provider));

async function deploy(name: string, args: unknown[]): Promise<Contract> {
  const art = artifacts[name];
  if (!art) throw new Error(`no artifact: ${name}`);
  const f = new ContractFactory(art.abi, art.bytecode, wallet);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`deployed ${name.padEnd(16)} ${addr}  (tx ${c.deploymentTransaction()?.hash})`);
  return c as Contract;
}

async function main() {
  const me = await (wallet.signer as Wallet).getAddress();
  const net = await provider.getNetwork();
  const bal = await provider.getBalance(me);
  console.log(`network chainId=${net.chainId} deployer=${me} balance=${formatEther(bal)} ETH\n`);
  if (net.chainId !== 84532n) throw new Error(`expected Base Sepolia (84532), got ${net.chainId}`);

  const operator = me; // TESTNET: single ops key; multisig at mainnet per trust model

  const usdc = await deploy("MockUSDC", []);
  const vault = await deploy("PerpVault", [operator, await usdc.getAddress()]);
  const settlement = await deploy("Settlement", [operator, await vault.getAddress()]);
  const registry = await deploy("RiskRegistry", [operator]);
  const oracle = await deploy("OracleAdapter", [operator]);
  const tranches = await deploy("PVaultTranches", [operator, await usdc.getAddress()]);

  console.log("\nwiring + smoke tests:");
  await (await (vault as any).setAuthorized(await settlement.getAddress(), true)).wait();
  console.log("  vault.setAuthorized(settlement) ✓");

  await (await (oracle as any).postPrice(500_000_000_000n, 0)).wait(); // 5000.00, TestnetFeed
  const p = await (oracle as any).latestPrice();
  console.log(`  oracle.postPrice → latestPrice = ${Number(p[0]) / 1e8} (source ${p[2]}) ✓`);

  await (await (registry as any).postGapReading(1_000_000, 0, 0, "gap-v0.0-genesis")).wait();
  const g = await (registry as any).latestGap();
  console.log(`  registry.postGapReading → coefficient ${Number(g[0]) / 1e6} model ${g[4]} ✓`);

  await (await (usdc as any).faucet()).wait();
  const b = await (usdc as any).balanceOf(me);
  console.log(`  usdc.faucet → balance ${Number(b) / 1e6} mUSDC ✓`);

  const spent = bal - (await provider.getBalance(me));
  console.log(`\ngas spent: ${formatEther(spent)} ETH`);

  const out = {
    network: "base-sepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: me,
    operator,
    contracts: {
      MockUSDC: await usdc.getAddress(),
      PerpVault: await vault.getAddress(),
      Settlement: await settlement.getAddress(),
      RiskRegistry: await registry.getAddress(),
      OracleAdapter: await oracle.getAddress(),
      PVaultTranches: await tranches.getAddress(),
    },
  };
  mkdirSync(join(here, "..", "deployments"), { recursive: true });
  writeFileSync(join(here, "..", "deployments", "base-sepolia.json"), JSON.stringify(out, null, 2));
  console.log("\nwrote contracts/deployments/base-sepolia.json");
}

main().catch((e) => {
  console.error("DEPLOY FAILED:", e?.message ?? e);
  process.exit(1);
});
