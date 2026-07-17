/** Thin deterministic EVM test harness: ethereumjs VM + ethers ABI coding. */
import { VM } from "@ethereumjs/vm";
import { Block } from "@ethereumjs/block";
import { Address, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { Interface, type InterfaceAbi, type LogDescription } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const artifacts: Record<string, { abi: InterfaceAbi; bytecode: string }> = JSON.parse(
  readFileSync(join(here, "build.json"), "utf8"),
);

export const addr = (n: number): string => "0x" + n.toString(16).padStart(40, "0");

export class RevertError extends Error {
  constructor(
    public errorName: string,
    public raw: string,
  ) {
    super(`reverted: ${errorName}`);
  }
}

export class Chain {
  vm!: VM;
  now = 1_800_000_000; // deterministic genesis time
  private deployNonce = 0;

  static async create(): Promise<Chain> {
    const c = new Chain();
    c.vm = await VM.create();
    return c;
  }

  advance(seconds: number): void {
    this.now += seconds;
  }

  makeBlock(): Block {
    return Block.fromBlockData({ header: { number: 1n, timestamp: BigInt(this.now), gasLimit: 30_000_000n } });
  }

  async deploy(name: string, args: unknown[]): Promise<Contract> {
    const art = artifacts[name];
    if (!art) throw new Error(`no artifact ${name}`);
    const iface = new Interface(art.abi);
    // distinct deployer per deploy → distinct create addresses regardless of nonce handling
    const deployer = addr(0xd0000 + this.deployNonce++);
    const data = art.bytecode + (args.length ? iface.encodeDeploy(args).slice(2) : "");
    const res = await this.vm.evm.runCall({
      caller: Address.fromString(deployer),
      data: hexToBytes(data as `0x${string}`),
      gasLimit: 100_000_000n,
      block: this.makeBlock(),
    });
    if (res.execResult.exceptionError) {
      throw new Error(
        `deploy ${name} failed: ${res.execResult.exceptionError.error} ${bytesToHex(res.execResult.returnValue)}`,
      );
    }
    return new Contract(this, res.createdAddress!.toString(), iface, name);
  }
}

export class Contract {
  constructor(
    public chain: Chain,
    public address: string,
    public iface: Interface,
    public name: string,
  ) {}

  private decodeRevert(ret: Uint8Array): string {
    const hex = bytesToHex(ret);
    if (hex === "0x") return "(no data)";
    try {
      const parsed = this.iface.parseError(hex);
      if (parsed) return parsed.name;
    } catch {
      /* fall through */
    }
    return hex.slice(0, 20);
  }

  private async run(fn: string, args: unknown[], from: string) {
    const data = this.iface.encodeFunctionData(fn, args);
    const res = await this.chain.vm.evm.runCall({
      caller: Address.fromString(from),
      to: Address.fromString(this.address),
      data: hexToBytes(data as `0x${string}`),
      gasLimit: 100_000_000n,
      block: this.chain.makeBlock(),
    });
    if (res.execResult.exceptionError) {
      throw new RevertError(this.decodeRevert(res.execResult.returnValue), bytesToHex(res.execResult.returnValue));
    }
    return res;
  }

  /** state-mutating call from `from`; throws RevertError on revert; returns decoded logs */
  async call(fn: string, args: unknown[], from: string): Promise<{ logs: LogDescription[] }> {
    const res = await this.run(fn, args, from);
    const logs: LogDescription[] = [];
    for (const l of res.execResult.logs ?? []) {
      try {
        const parsed = this.iface.parseLog({ topics: l[1].map((t) => bytesToHex(t)), data: bytesToHex(l[2]) });
        if (parsed) logs.push(parsed);
      } catch {
        /* another contract's event shape */
      }
    }
    return { logs };
  }

  /** read (view) call; returns the decoded result (unwrapped when single value) */
  async read(fn: string, args: unknown[] = [], from: string = addr(0xcafe)): Promise<any> {
    const res = await this.run(fn, args, from);
    const decoded = this.iface.decodeFunctionResult(fn, bytesToHex(res.execResult.returnValue));
    return decoded.length === 1 ? decoded[0] : decoded;
  }
}

/** expect a RevertError with the given custom error name */
export async function expectRevert(p: Promise<unknown>, errorName: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RevertError && e.errorName === errorName) return;
    throw new Error(`expected revert ${errorName}, got: ${e instanceof Error ? e.message : e}`);
  }
  throw new Error(`expected revert ${errorName}, but call succeeded`);
}
