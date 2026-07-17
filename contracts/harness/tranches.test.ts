import { beforeEach, describe, expect, it } from "vitest";
import { addr, Chain, expectRevert, RevertError, type Contract } from "./evm.js";

const OP = addr(0xa1);
const SEN = addr(0xb1); // senior LP
const JUN = addr(0xb2); // junior LP
const RECAP = addr(0xb3); // recapitalizing junior LP

const usd = (n: number): bigint => BigInt(Math.round(n * 1e6));
const MAX = 2n ** 256n - 1n;

let chain: Chain;
let usdc: Contract;
let t: Contract;

async function conservation(): Promise<void> {
  const bal: bigint = await usdc.read("balanceOf", [t.address]);
  const s: bigint = await t.read("seniorNav");
  const j: bigint = await t.read("juniorNav");
  const r: bigint = await t.read("yieldReserve");
  expect(bal, `conservation: bal=${bal} s=${s} j=${j} r=${r}`).toBe(s + j + r);
}

beforeEach(async () => {
  chain = await Chain.create();
  usdc = await chain.deploy("MockUSDC", []);
  t = await chain.deploy("PVaultTranches", [OP, usdc.address]);
  for (const u of [OP, SEN, JUN, RECAP]) {
    await usdc.call("mintTo", [u, usd(10_000_000)], u);
    await usdc.call("approve", [t.address, MAX], u);
  }
});

async function seed80_20(): Promise<void> {
  await t.call("depositSenior", [usd(80_000)], SEN);
  await t.call("depositJunior", [usd(20_000)], JUN);
}

describe("PVaultTranches: deposits and shares", () => {
  it("initial deposits mint 1:1 and state reads correctly", async () => {
    await seed80_20();
    expect(await t.read("seniorNav")).toBe(usd(80_000));
    expect(await t.read("juniorNav")).toBe(usd(20_000));
    expect(await t.read("sharesOfSenior", [SEN])).toBe(usd(80_000));
    expect(await t.read("juniorRatioBps")).toBe(2000n);
    await conservation();
  });
});

describe("PVaultTranches: the waterfall", () => {
  it("Scenario A (house wins): senior accrues daily target, 15% reserve cut, junior takes the rest", async () => {
    await seed80_20();
    await t.call("settleEpoch", [usd(1_000)], OP);

    const target = (usd(80_000) * 1200n) / 10_000n / 365n; // 26_301_369
    expect(await t.read("seniorNav")).toBe(usd(80_000) + target);
    const rest = usd(1_000) - target;
    const reserve = (rest * 1500n) / 10_000n;
    expect(await t.read("yieldReserve")).toBe(reserve);
    expect(await t.read("juniorNav")).toBe(usd(20_000) + rest - reserve);
    await conservation();

    // junior earned ~4x the senior's rate on a quarter of the capital → leveraged upside
    const juniorGain = rest - reserve;
    expect(Number(juniorGain) / 20_000e6).toBeGreaterThan((4 * Number(target)) / 80_000e6);
  });

  it("dynamic yield curve: junior under 15% of TVL routes ALL profit to junior", async () => {
    await t.call("depositSenior", [usd(90_000)], SEN);
    await t.call("depositJunior", [usd(10_000)], JUN); // 10% < 15%
    await t.call("settleEpoch", [usd(1_000)], OP);
    expect(await t.read("seniorNav")).toBe(usd(90_000)); // no senior accrual
    expect(await t.read("yieldReserve")).toBe(0n);
    expect(await t.read("juniorNav")).toBe(usd(11_000));
    await conservation();
  });

  it("Scenario B (house loses, within junior): junior absorbs fully, senior untouched", async () => {
    await seed80_20();
    const opBefore: bigint = await usdc.read("balanceOf", [OP]);
    await t.call("settleEpoch", [-usd(5_000)], OP);
    expect(await t.read("juniorNav")).toBe(usd(15_000));
    expect(await t.read("seniorNav")).toBe(usd(80_000));
    expect(await t.read("catastropheMode")).toBe(false);
    expect(await usdc.read("balanceOf", [OP])).toBe(opBefore + usd(5_000)); // covered loss returns to trading vault
    await conservation();
  });

  it("junior wipe → generation bump voids shares, catastrophe mode, senior absorbs the excess", async () => {
    await seed80_20();
    const { logs } = await t.call("settleEpoch", [-usd(25_000)], OP);
    expect(logs.some((l) => l.name === "JuniorWiped")).toBe(true);
    expect(logs.some((l) => l.name === "CatastropheEntered")).toBe(true);
    expect(await t.read("juniorNav")).toBe(0n);
    expect(await t.read("seniorNav")).toBe(usd(75_000));
    expect(await t.read("catastropheMode")).toBe(true);
    expect(await t.read("sharesOfJunior", [JUN])).toBe(0n); // wiped generation
    await conservation();
  });

  it("catastrophe: senior exits pay 1% that recapitalizes junior; recovery at 10% ratio exits catastrophe", async () => {
    await seed80_20();
    await t.call("settleEpoch", [-usd(25_000)], OP); // junior wiped, senior 75k, catastrophe

    // senior partial exit pays the 1% cure fee → juniorNav grows
    await t.call("withdrawSenior", [usd(10_000)], SEN); // 12.5% of position (< 25% cap)
    const fee = ((usd(10_000) * usd(75_000)) / usd(80_000) / 100n); // 1% of value
    expect(await t.read("juniorNav")).toBe(fee);
    await conservation();

    // recap window: fresh junior deposits mint against the surplus (bonus by design)
    await t.call("depositJunior", [usd(5_000)], RECAP);
    expect(await t.read("sharesOfJunior", [RECAP])).toBe(usd(5_000)); // new generation, mint = amount
    expect(await t.read("catastropheMode")).toBe(true); // not yet 10% of senior

    // profitable epochs route everything to junior (ratio below 15%) until recovery
    await t.call("settleEpoch", [usd(2_000)], OP);
    const j: bigint = await t.read("juniorNav");
    const s: bigint = await t.read("seniorNav");
    expect(j * 10_000n >= s * 1000n).toBe(true);
    expect(await t.read("catastropheMode")).toBe(false); // recovered
    await conservation();
  });

  it("insolvency: losses beyond the full stack halt the contract", async () => {
    await t.call("depositSenior", [usd(10_000)], SEN);
    await t.call("depositJunior", [usd(2_000)], JUN);
    const { logs } = await t.call("settleEpoch", [-usd(50_000)], OP);
    expect(logs.some((l) => l.name === "InsolvencyDeclared")).toBe(true);
    expect(await t.read("insolvent")).toBe(true);
    await expectRevert(t.call("depositSenior", [usd(1)], SEN), "Insolvent");
    await conservation(); // even in death, the books balance
  });
});

describe("PVaultTranches: protections", () => {
  it("junior 48h lock-up", async () => {
    await seed80_20();
    await expectRevert(t.call("withdrawJunior", [usd(1_000)], JUN), "Locked");
    chain.advance(48 * 3600 + 1);
    await t.call("withdrawJunior", [usd(1_000)], JUN);
    expect(await usdc.read("balanceOf", [JUN])).toBe(usd(10_000_000) - usd(20_000) + usd(1_000));
    await conservation();
  });

  it("senior concentration cap: >5% holders limited to 25% of position per withdrawal", async () => {
    await seed80_20(); // SEN holds 100% of senior
    await expectRevert(t.call("withdrawSenior", [usd(30_000)], SEN), "ConcentrationCap");
    await t.call("withdrawSenior", [usd(20_000)], SEN); // exactly 25%
    expect(await t.read("seniorNav")).toBe(usd(60_000));
    await conservation();
  });
});

describe("PVaultTranches: fuzz — the books always balance", () => {
  it("150 random operations: conservation after every op; senior untouched while junior lives", async () => {
    let x = 987654321 >>> 0;
    const rng = () => {
      x = (Math.imul(1103515245, x) + 12345) >>> 0;
      return x / 4294967296;
    };

    await seed80_20();
    for (let i = 0; i < 150; i++) {
      const r = rng();
      try {
        if (r < 0.2) {
          await t.call("depositSenior", [usd(Math.floor(rng() * 5000) + 1)], SEN);
        } else if (r < 0.4) {
          await t.call("depositJunior", [usd(Math.floor(rng() * 2000) + 1)], rng() < 0.5 ? JUN : RECAP);
        } else if (r < 0.5) {
          const shares: bigint = await t.read("sharesOfSenior", [SEN]);
          if (shares > 4n) await t.call("withdrawSenior", [shares / 5n], SEN);
        } else if (r < 0.6) {
          const who = rng() < 0.5 ? JUN : RECAP;
          const shares: bigint = await t.read("sharesOfJunior", [who]);
          if (shares > 2n) await t.call("withdrawJunior", [shares / 2n], who);
        } else if (r < 0.75) {
          chain.advance(Math.floor(rng() * 3 * 86_400));
        } else {
          const sNav: bigint = await t.read("seniorNav");
          const jNav: bigint = await t.read("juniorNav");
          const res: bigint = await t.read("yieldReserve");
          const jBefore = jNav;
          const sBefore = sNav;
          if (rng() < 0.6) {
            await t.call("settleEpoch", [usd(Math.floor(rng() * 3000) + 1)], OP);
          } else {
            const tvl = Number(sNav + jNav + res) / 1e6;
            const loss = usd(Math.floor(rng() * tvl * 0.5) + 1);
            await t.call("settleEpoch", [-loss], OP);
            // first-loss ordering: senior may only shrink if the loss exceeded junior+reserve
            const sAfter: bigint = await t.read("seniorNav");
            if (loss <= jBefore + res) expect(sAfter).toBe(sBefore);
          }
        }
      } catch (e) {
        if (!(e instanceof RevertError)) throw e; // reverts are legal outcomes; imbalance is not
      }
      await conservation();
      if (await t.read("insolvent")) break; // stack exhausted — the halt itself was verified above
    }
  }, 60_000);
});
