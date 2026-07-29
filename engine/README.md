# @perpify/engine

Off-chain matching engine. See `../ARCHITECTURE.md` §4.2.

**The one rule:** the core is a pure state machine — `apply(state, command) → {state, events}`.
No clocks, no I/O, no randomness inside the core. Time, oracle prices, and risk readings enter
as sequenced commands. Violating this breaks replayability, and replayability is a product
feature (fairness log + reopen replay demo).

## Modules (build order for M1)

1. `types.ts` — domain types (done, review first)
2. `book.ts` — price-time CLOB (pure)
3. `margin.ts` — isolated margin math (pure)
4. `core.ts` — the state machine wiring commands → book/margin/funding/liquidation
5. `funding.ts`, `liquidation.ts` — pure
6. `log.ts` — hash-chained event log (Postgres append-only)
7. `intake.ts` — REST/WS, EIP-712 verification (impure shell)
8. `settlement.ts` — epoch batcher → Base Sepolia (impure shell)
9. `replay.ts` — rebuild full state from the command log; must be byte-identical

## Wire layer (`src/wire/`)

The engine serves the Density frontend dialect (see `docs/density-reuse-map.md`,
harvest #1) so the M2 UI transplant is mechanical: `density.ts` pure mappers
(ORDER_TRADE_UPDATE / ACCOUNT_UPDATE envelopes, aggregated `{bp,ap,…,b,a}` book,
position-monitoring risk shape with live-coefficient liquidation prices), `bus.ts`
(per-owner fan-out over the pure core), `server.ts` (the three ws endpoints, ping/pong
heartbeat, origin allowlist). The `marketDataStream` carries a Perpify extension: `gc`,
the live gap coefficient, rides every price frame.

## Testing bar

- Property tests on book invariants (no crossed book, price-time honored, qty conservation)
- Property tests on margin/liquidation edge cases (the hard 20%)
- Golden replay test: same log in → same state root out
