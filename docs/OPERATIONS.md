# Perpify Testnet Operations

Two service cycles keep the venue's on-chain state honest. Both are single-shot
commands designed for a scheduler — no daemons, no state outside the repo + chain.

## 1. Risk cycle — gap reading

```
risk/gap/cycle.sh
```
Computes the current coefficient from the fitted model + session clock
(`publish.py`), then posts it to `RiskRegistry` (`post-reading.ts`).

Cadence (playbook §2.2): every 4h during dark periods, hourly near session
boundaries. v0 cron:

```
0 */4 * * *  cd /path/to/perpify && risk/gap/cycle.sh >> /var/log/perpify-risk.log 2>&1
```

## 2. Epoch cycle — engine settlement

```
cd engine && npm run epoch-cycle
```
Ingests vault deposits from chain events, ticks the engine from the on-chain oracle,
applies the current risk reading, closes the epoch, posts the state root + event-chain
head to `Settlement`, and verifies the chain matches the engine byte-for-byte.
Refuses to settle if the conservation law breaks.

Cadence: daily (24h epochs, playbook §2.6):

```
5 0 * * *  cd /path/to/perpify/engine && npm run epoch-cycle >> /var/log/perpify-epoch.log 2>&1
```

## Hosting (decision parked until backlog item 8)

These cycles currently run from any machine with the repo + `contracts/.env`
(operator key). Item 8's done-check — a live book through a full weekend unattended —
forces an always-on host: either Aakash's Mac (never sleeps, plugged in) or a ~$5/mo
VPS. The engine's continuous mode (websocket server + matching loop) arrives with the
same item; until then the venue is a sequence of verified snapshots, which is exactly
what a settlement layer needs.

## Notes

- Public RPC (`sepolia.base.org`) rate-limits: log scans are chunked from
  `deployBlock` with pacing + retries (`engine/src/chain.ts`). If cycles ever slow
  down, an Alchemy free-tier key in `contracts/.env` is a drop-in upgrade.
- Oracle price is a TESTNET FEED (dataset SPY close × 10 proxy) until the Pyth pull
  integration (M2). Every posted price is labeled with its source on-chain.
- The operator key signs everything; it lives in `contracts/.env` (never committed).
