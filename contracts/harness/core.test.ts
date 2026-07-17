import { beforeEach, describe, expect, it } from "vitest";
import { addr, Chain, expectRevert, type Contract } from "./evm.js";

const OP = addr(0xa1);
const U1 = addr(0xb1);
const U2 = addr(0xb2);
const STRANGER = addr(0xee);

const usd = (n: number): bigint => BigInt(Math.round(n * 1e6));
const ROOT = "0x" + "11".repeat(32);
const HEAD = "0x" + "22".repeat(32);
const ZERO32 = "0x" + "00".repeat(32);

let chain: Chain;
let usdc: Contract;

beforeEach(async () => {
  chain = await Chain.create();
  usdc = await chain.deploy("MockUSDC", []);
});

describe("MockUSDC", () => {
  it("faucet drips 10k with a 24h cooldown", async () => {
    await usdc.call("faucet", [], U1);
    expect(await usdc.read("balanceOf", [U1])).toBe(usd(10_000));
    await expectRevert(usdc.call("faucet", [], U1), "FaucetCooldown");
    chain.advance(86_400);
    await usdc.call("faucet", [], U1);
    expect(await usdc.read("balanceOf", [U1])).toBe(usd(20_000));
  });

  it("transfer + allowance mechanics", async () => {
    await usdc.call("mintTo", [U1, usd(100)], U1);
    await usdc.call("transfer", [U2, usd(40)], U1);
    expect(await usdc.read("balanceOf", [U2])).toBe(usd(40));
    await expectRevert(usdc.call("transferFrom", [U1, U2, usd(10)], U2), "InsufficientAllowance");
    await usdc.call("approve", [U2, usd(10)], U1);
    await usdc.call("transferFrom", [U1, U2, usd(10)], U2);
    expect(await usdc.read("balanceOf", [U1])).toBe(usd(50));
    await expectRevert(usdc.call("transfer", [U2, usd(1_000_000)], U1), "InsufficientBalance");
  });
});

describe("PerpVault", () => {
  let vault: Contract;

  beforeEach(async () => {
    vault = await chain.deploy("PerpVault", [OP, usdc.address]);
    await usdc.call("mintTo", [U1, usd(50_000)], U1);
    await usdc.call("approve", [vault.address, usd(50_000)], U1);
  });

  it("deposit custody + event; withdraw request is an event-only signal", async () => {
    const { logs } = await vault.call("deposit", [usd(20_000)], U1);
    expect(logs.find((l) => l.name === "Deposited")?.args.amount).toBe(usd(20_000));
    expect(await usdc.read("balanceOf", [vault.address])).toBe(usd(20_000));
    expect(await vault.read("totalDeposited")).toBe(usd(20_000));
    const req = await vault.call("requestWithdraw", [usd(5_000)], U1);
    expect(req.logs.find((l) => l.name === "WithdrawRequested")?.args.amount).toBe(usd(5_000));
    await expectRevert(vault.call("deposit", [0n], U1), "ZeroAmount");
  });

  it("payOut is operator/authorized-only", async () => {
    await vault.call("deposit", [usd(20_000)], U1);
    await expectRevert(vault.call("payOut", [U2, usd(1_000)], STRANGER), "NotAuthorized");
    await vault.call("payOut", [U2, usd(1_000)], OP);
    expect(await usdc.read("balanceOf", [U2])).toBe(usd(1_000));
    // authorize a settlement address (EOA stand-in), then it can pay out too
    await vault.call("setAuthorized", [U2, true], OP);
    await vault.call("payOut", [U1, usd(500)], U2);
    expect(await vault.read("totalPaidOut")).toBe(usd(1_500));
    await expectRevert(vault.call("setAuthorized", [U2, true], STRANGER), "NotOperator");
  });
});

describe("Settlement", () => {
  let vault: Contract;
  let settlement: Contract;

  beforeEach(async () => {
    vault = await chain.deploy("PerpVault", [OP, usdc.address]);
    settlement = await chain.deploy("Settlement", [OP, vault.address]);
    await vault.call("setAuthorized", [settlement.address, true], OP);
    await usdc.call("mintTo", [U1, usd(50_000)], U1);
    await usdc.call("approve", [vault.address, usd(50_000)], U1);
    await vault.call("deposit", [usd(50_000)], U1);
  });

  it("posts sequential epochs with roots and executes payout batches", async () => {
    const { logs } = await settlement.call(
      "settleEpoch",
      [1, ROOT, HEAD, 1234, [{ user: U2, amount: usd(1_000) }]],
      OP,
    );
    expect(logs.find((l) => l.name === "EpochSettled")?.args.payoutCount).toBe(1n);
    expect(await usdc.read("balanceOf", [U2])).toBe(usd(1_000));
    const epoch = await settlement.read("epochs", [1]);
    expect(epoch[0]).toBe(ROOT);
    expect(epoch[1]).toBe(HEAD);
    await expectRevert(settlement.call("settleEpoch", [3, ROOT, HEAD, 1, []], OP), "NonSequentialEpoch");
    await expectRevert(settlement.call("settleEpoch", [2, ZERO32, HEAD, 1, []], OP), "EmptyRoot");
    await expectRevert(settlement.call("settleEpoch", [2, ROOT, HEAD, 1, []], STRANGER), "NotOperator");
  });
});

describe("RiskRegistry", () => {
  let registry: Contract;

  beforeEach(async () => {
    registry = await chain.deploy("RiskRegistry", [OP]);
  });

  it("gap readings: bounds + latest state", async () => {
    await registry.call("postGapReading", [1_420_000, 2, 405, "gap-v0.1"], OP);
    const g = await registry.read("latestGap");
    expect(g[0]).toBe(1_420_000n);
    expect(g[4]).toBe("gap-v0.1");
    await expectRevert(registry.call("postGapReading", [900_000, 0, 0, "x"], OP), "BadCoefficient");
    await expectRevert(registry.call("postGapReading", [1_100_000, 0, 0, "x"], STRANGER), "NotOperator");
  });

  it("confidence, explainers (no dups), model registry", async () => {
    await registry.call("postConfidence", [980_000, false], OP);
    expect((await registry.read("latestConfidence"))[0]).toBe(980_000n);
    const h = "0x" + "ab".repeat(32);
    await registry.call("postExplainer", [h, U1, 777], OP);
    expect(await registry.read("explainerCount")).toBe(1n);
    await expectRevert(registry.call("postExplainer", [h, U1, 778], OP), "AlreadyPosted");
    await registry.call("registerModel", ["tier@v0.1", ROOT], OP);
    expect(await registry.read("modelArtifact", ["tier@v0.1"])).toBe(ROOT);
  });
});

describe("OracleAdapter", () => {
  it("push, read, staleness fail-closed", async () => {
    const oracle = await chain.deploy("OracleAdapter", [OP]);
    await expectRevert(oracle.read("latestPrice"), "BadPrice"); // nothing posted yet
    await oracle.call("postPrice", [500_000_000_000n, 0], OP); // 5000.00 in 1e8
    const p = await oracle.read("latestPrice");
    expect(p[0]).toBe(500_000_000_000n);
    chain.advance(16 * 60); // > MAX_STALENESS
    await expectRevert(oracle.read("latestPrice"), "StalePrice");
    await expectRevert(oracle.call("postPrice", [0n, 0], OP), "BadPrice");
    await expectRevert(oracle.call("postPrice", [1n, 0], STRANGER), "NotOperator");
  });
});
