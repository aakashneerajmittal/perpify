# Perpify — Testnet V1 Monorepo

**Prices the dark. Clears the reopen.**

Perpify is a perpetual futures venue for equity indices (SPX first), settled in USDC on Base,
where margin, leverage, liquidation priority, and reopen ordering are live model outputs rather
than static tables.

This repo is the testnet V1 implementation. Scope is frozen per the Product Playbook §3 (V1):
one market (SPX-PERP), isolated margin, USDC only, Base Sepolia.

## Layout

```
contracts/   Solidity (Foundry) — custody, settlement, PVault tranches, oracle adapter
engine/      TypeScript — off-chain matching engine, margin, funding, liquidations, API/WS
risk/        Python — gap model, behavioral tier v0, reopen sequencer, oracle confidence
apps/web/    Next.js — trading UI, PVault page, risk dashboards
bots/        Quoting bot (PVault maker), taker bots, liquidator keeper
sdk/         TS/Python clients + MCP server (M3)
docs/        ADRs and specs
```

Start with [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the whole machine on one page, plus
milestones M0–M4.

## Status

- **M0:** repo scaffold + architecture freeze — done.
- **M1 (in progress):** deterministic engine core — DONE (book, isolated margin with
  gap×tier coefficients, funding, liquidations with signed explainers, insurance-fund
  backstop, conservation law, hash-chained events, byte-identical replay; 23 tests incl.
  400-command fuzz). Run `cd engine && npm install && npm test && npm run demo`.
- Next in M1: contracts v0 (Foundry) + Sepolia deploy; engine ↔ chain settlement.
- Blocked on operator: SPY CSV (gap stats), GitHub repo, Alchemy/Basescan keys.

## Principles (from the Playbook — non-negotiable)

1. Stay narrow. One market until the risk engine has earned the right to widen.
2. Every risk parameter a participant faces must be queryable and explainable.
3. The matching core is deterministic and replayable. No wall-clock, no randomness.
4. AI claims must be product truth: if the tier doesn't move margin measurably, hide it.
5. Testnet is a demo of the differentiators, not a promise of mainnet safety. Mainnet waits
   for audits.
