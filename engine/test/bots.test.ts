import { beforeEach, describe, expect, it } from "vitest";
import { EngineBus } from "../src/wire/bus.js";
import { MakerBot, DEFAULT_MAKER } from "../src/bots/maker.js";
import { TakerBot } from "../src/bots/taker.js";
import { checkConservation } from "../src/state.js";
import { deposit, gapReading, resetIds, tick } from "./helpers.js";

const MM = "0x3a4ke00000000000000000000000000000000009";
const TK = "0x7a4e100000000000000000000000000000000011";

beforeEach(() => resetIds());

function setup(): { bus: EngineBus; maker: MakerBot } {
  const bus = new EngineBus();
  bus.dispatch(tick(5000));
  const maker = new MakerBot(bus, { owner: MM, ...DEFAULT_MAKER });
  maker.fund(1_000_000);
  return { bus, maker };
}

describe("maker bot", () => {
  it("quotes a full ladder around index", () => {
    const { bus, maker } = setup();
    maker.requote();
    const book = bus.bookSnapshot(10, 2);
    expect(book.b.length).toBe(DEFAULT_MAKER.levels);
    expect(book.a.length).toBe(DEFAULT_MAKER.levels);
    expect(Number(book.b[0]!.P)).toBeLessThan(5000);
    expect(Number(book.a[0]!.P)).toBeGreaterThan(5000);
  });

  it("THE THESIS ON THE BOOK: spread widens exactly with the gap coefficient", () => {
    const { bus, maker } = setup();
    maker.requote();
    const calm = bus.bookSnapshot(1, 2);
    const calmSpread = Number(calm.a[0]!.P) - Number(calm.b[0]!.P);

    bus.dispatch(gapReading(1.5, "weekend"));
    maker.requote();
    const dark = bus.bookSnapshot(1, 2);
    const darkSpread = Number(dark.a[0]!.P) - Number(dark.b[0]!.P);

    expect(maker.quotedHalfSpreadBps()).toBeCloseTo(DEFAULT_MAKER.baseSpreadBps * 1.5, 6);
    expect(darkSpread / calmSpread).toBeGreaterThan(1.3); // physically wider book
    expect(darkSpread / calmSpread).toBeLessThan(1.7);
  });

  it("requote cancels stale quotes — book never accumulates", () => {
    const { bus, maker } = setup();
    for (let i = 0; i < 5; i++) maker.requote();
    const book = bus.bookSnapshot(20, 2);
    expect(book.b.length).toBe(DEFAULT_MAKER.levels);
    expect(book.a.length).toBe(DEFAULT_MAKER.levels);
    expect(checkConservation(bus.state).holds).toBe(true);
  });
});

describe("maker + taker ecosystem", () => {
  it("takers trade against the ladder; positions form; conservation holds throughout", () => {
    const { bus, maker } = setup();
    const taker = new TakerBot(bus, {
      owner: TK,
      seed: 7,
      maxQty: 0.5,
      aggressionBps: 30,
      tradeEveryMs: 0,
      longBias: 0.6,
    });
    taker.fund(50_000);

    let trades = 0;
    bus.subscribe(TK, (m) => {
      if (m.eventType === "ORDER_TRADE_UPDATE" && (m.eventData as any).status !== "CANCELED") trades++;
    });

    for (let i = 0; i < 30; i++) {
      maker.requote();
      taker.step();
      const c = checkConservation(bus.state);
      expect(c.holds, `step ${i}: drift ${c.driftAbs}`).toBe(true);
    }
    expect(trades).toBeGreaterThan(5);
    const makerAcct = bus.state.accounts.get(MM)!;
    const takerAcct = bus.state.accounts.get(TK)!;
    expect(makerAcct.position !== null || takerAcct.position !== null).toBe(true);
  });
});
