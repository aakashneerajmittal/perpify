/**
 * Chain client — the engine's only bridge to Base Sepolia.
 * Reads: vault deposits (chain → engine command ingestion), oracle raw price, epochs.
 * Writes (operator role): oracle price posts, epoch settlement.
 * Everything else in the engine stays pure and chain-ignorant by design.
 */
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";

export interface Deployment {
  chainId: number;
  contracts: Record<string, string>;
  deployBlock?: number;
}

export interface ChainDeposit {
  owner: string;
  amount6: bigint;
  txHash: string;
  blockNumber: number;
}

/** public RPC caps eth_getLogs to 2000-block windows */
const LOG_CHUNK = 1_990;
const MAX_CHUNKS = 60; // ~120k blocks ≈ 2.7 days on Base — engine keeps a cursor beyond that (M2)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ChainClient {
  provider: JsonRpcProvider;
  wallet: NonceManager;
  deployBlock: number;
  vault: any;
  settlement: any;
  oracle: any;
  registry: any;
  usdc: any;

  constructor(rpcUrl: string, privateKey: string, deployment: Deployment, abis: Record<string, { abi: unknown }>) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.deployBlock = deployment.deployBlock ?? 0;
    this.wallet = new NonceManager(new Wallet(privateKey, this.provider));
    const c = (name: string) => new Contract(deployment.contracts[name]!, (abis[name] as any).abi, this.wallet);
    this.vault = c("PerpVault");
    this.settlement = c("Settlement");
    this.oracle = c("OracleAdapter");
    this.registry = c("RiskRegistry");
    this.usdc = c("MockUSDC");
  }

  static fromRepo(repoRoot: string): ChainClient {
    const env: Record<string, string> = {};
    for (const line of readFileSync(`${repoRoot}/contracts/.env`, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]!] = m[2]!.trim();
    }
    const deployment = JSON.parse(readFileSync(`${repoRoot}/contracts/deployments/base-sepolia.json`, "utf8"));
    const abis = JSON.parse(readFileSync(`${repoRoot}/contracts/harness/build.json`, "utf8"));
    return new ChainClient(env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", env.PRIVATE_KEY!, deployment, abis);
  }

  async operatorAddress(): Promise<string> {
    return await (this.wallet.signer as Wallet).getAddress();
  }

  /** Deposited events since deployment, scanned forward in RPC-friendly chunks with
   *  polite pacing and rate-limit retries (public endpoint etiquette). */
  async fetchDeposits(): Promise<ChainDeposit[]> {
    const latest = await this.provider.getBlockNumber();
    const out: ChainDeposit[] = [];
    let from = this.deployBlock;
    let chunks = 0;
    while (from <= latest && chunks < MAX_CHUNKS) {
      const to = Math.min(latest, from + LOG_CHUNK);
      let events: any[] = [];
      for (let attempt = 0; ; attempt++) {
        try {
          events = await this.vault.queryFilter(this.vault.filters.Deposited(), from, to);
          break;
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (attempt < 4 && (msg.includes("rate limit") || msg.includes("-32016"))) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
      for (const e of events) {
        out.push({
          owner: (e.args.user as string).toLowerCase(),
          amount6: BigInt(e.args.amount),
          txHash: e.transactionHash,
          blockNumber: e.blockNumber,
        });
      }
      from = to + 1;
      chunks++;
      await sleep(350);
    }
    if (from <= latest) {
      throw new Error(`deposit scan incomplete: reached block ${from} of ${latest} — raise MAX_CHUNKS or add a cursor`);
    }
    return out.sort((a, b) => a.blockNumber - b.blockNumber);
  }

  /** raw oracle struct (no staleness gate — callers decide policy) */
  async readOracleRaw(): Promise<{ price1e8: bigint; postedAt: number; source: number }> {
    const p = await this.oracle.latest();
    return { price1e8: BigInt(p[0]), postedAt: Number(p[1]), source: Number(p[2]) };
  }

  async postOraclePrice(price1e8: bigint): Promise<string> {
    const tx = await this.oracle.postPrice(price1e8, 0); // 0 = TestnetFeed, clearly labeled
    await tx.wait();
    return tx.hash;
  }

  async lastEpochId(): Promise<number> {
    return Number(await this.settlement.lastEpochId());
  }

  async settleEpoch(
    epochId: number,
    stateRoot: string,
    eventChainHead: string,
    engineSeq: number,
    payouts: { user: string; amount: bigint }[],
  ): Promise<string> {
    const tx = await this.settlement.settleEpoch(epochId, stateRoot, eventChainHead, engineSeq, payouts);
    await tx.wait();
    return tx.hash;
  }

  async readEpoch(epochId: number): Promise<{ stateRoot: string; eventChainHead: string; engineSeq: number }> {
    const e = await this.settlement.epochs(epochId);
    return { stateRoot: e[0], eventChainHead: e[1], engineSeq: Number(e[2]) };
  }

  /** demo/testnet helper: ensure at least one real deposit exists (operator deposits mUSDC) */
  async ensureDemoDeposit(amount6: bigint): Promise<ChainDeposit[]> {
    const existing = await this.fetchDeposits();
    if (existing.length > 0) return existing;
    const me = await this.operatorAddress();
    const bal: bigint = await this.usdc.balanceOf(me);
    if (bal < amount6) {
      const ftx = await this.usdc.faucet();
      await ftx.wait();
    }
    await (await this.usdc.approve(await this.vault.getAddress(), amount6)).wait();
    await (await this.vault.deposit(amount6)).wait();
    return await this.fetchDeposits();
  }
}
