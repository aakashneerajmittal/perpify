# Perpify — Testnet V1 Architecture

**Version 0.1 · July 16, 2026 · Status: draft for founder review**
Scope source: Product Playbook §3 (V1). This document freezes the testnet architecture.
Change it only by editing this file — no silent drift.

---

## 1. Goal and non-goals

**Goal.** A live venue on **Base Sepolia** where a visitor can, in one session: connect a wallet,
receive testnet USDC, see their provisional behavioral tier, open an SPX-PERP position whose
margin visibly depends on (tier × gap coefficient), watch the gap coefficient update during
dark periods, get liquidated with a signed explainer, and replay the March 2020 reopen through
the sequencer. That demo — not volume — is the fundraising artifact.

**Non-goals for testnet V1** (from the Playbook's must-not-ship list): cross-margin, multiple
markets, token, points, mobile, copy trading, subaccounts, governance, spot, fiat, social,
referral. Also explicitly out of scope at this stage: mainnet deployment, real funds, audits
(gated on funding), HFT-grade latency, own chain.

**Design stance.** Custody on-chain, matching off-chain. This is the dYdX-v3 pattern: users
deposit once into a Base contract, then trade gaslessly by signing orders. It reproduces the
Hyperliquid *feel* without the Hyperliquid L1. Fairness is defended by determinism and
published logs rather than by consensus (see §3).

---

## 2. System overview

```
                        ┌────────────────────────────────────────────┐
                        │                 apps/web                   │
                        │  trade UI · PVault · dashboards · passport │
                        └───────┬───────────────────────▲────────────┘
                                │ REST + signed orders  │ WebSocket (book/trades/positions/risk)
                                ▼                       │
┌──────────────┐  index px  ┌──────────────────────────────────────┐
│ oracle feeds │──────────▶│               engine/ (TS)             │
│ Pyth + CL    │           │  intake → risk gateway → CLOB → fills  │
└──────┬───────┘           │  margin · funding · liquidation ·      │
       │                   │  sequencer executor · event log        │
       │                   └────┬─────────────────────────┬─────────┘
       │ confidence             │ epoch batches +          │ commands/state
       ▼                        │ state roots              ▼
┌──────────────┐           ┌────▼─────────────┐   ┌──────────────────┐
│  risk/ (Py)  │  signed   │  contracts/ on   │   │  Postgres/Redis  │
│ gap model ·  │──────────▶│  Base Sepolia    │   │  order/event log │
│ tier v0 ·    │  readings │  vault · settle ·│   └──────────────────┘
│ sequencer ·  │           │  PVault · oracle │
│ confidence   │           └──────────────────┘
└──────────────┘
        bots/: PVault quoting bot · taker bots · liquidator keeper (drive the demo book)
```

One deliberate property: everything differentiated about Perpify (gap model, tiers, sequencer,
confidence) lives in `risk/` + `engine/` — plain services we fully control. The chain is used
for what chains are good at: custody, settlement finality, and public verifiability hooks.

---

## 3. Trust model (testnet V1 — stated honestly)

| Property | V1 mechanism | Upgrade path (post-funding) |
|---|---|---|
| Custody | On-chain vault; only user can trigger withdrawal of free collateral | unchanged |
| Order authenticity | EIP-712 signed orders with nonce + expiry; engine stores signatures | unchanged |
| Matching fairness | Deterministic price-time core; hash-chained event log; replay artifact | zk validity proofs (Lighter-style) or optimistic challenge window |
| State honesty | 24h-epoch state roots (Merkle of balances/positions) posted on-chain | proof-verified roots |
| Risk parameters | Signed readings (gap coeff, confidence) posted on-chain + queryable API | unchanged |
| Liquidations | Signed on-chain explainer per liquidation, replayable vs model version | unchanged |

The operator (us) is trusted for matching and margin in V1. We say so publicly. The mitigation
is that every input and output is signed, logged, and replayable — an auditor can recompute the
entire venue state from the order log. That is already more verifiable than any CEX and most
perp DEX testnets, and the proof-system upgrade is a funded-roadmap item, not a V1 blocker.

---

## 4. Components

### 4.1 `contracts/` — Solidity 0.8.x, Foundry

| Contract | Responsibility | Key surface |
|---|---|---|
| `PerpVault` | USDC custody; deposit/withdraw of free collateral; per-account balances credited by settlement | `deposit`, `requestWithdraw`, `withdraw`, `balanceOf` |
| `Settlement` | Operator posts epoch batches: net PnL, funding, fees, liquidations; stores epoch state root; emits full event trail | `settleEpoch(batch, stateRoot)`, `epochRoot(epochId)` |
| `PVaultTranches` | Senior/Junior deposit accounting; 24h epoch NAV updates; dynamic yield curve params; 48h Junior lock-up; catastrophe-mode flag | `depositSenior/Junior`, `epochNav`, `trancheState` |
| `OracleAdapter` | Wraps Pyth (primary) + Chainlink (check); stores latest signed confidence + gap coefficient from risk service; exposes reduce-only flag | `latestPrice`, `confidence`, `gapCoefficient`, `reduceOnly` |
| `RiskRegistry` | On-chain home of signed risk readings + liquidation explainer hashes + model version registry | `postReading`, `postExplainer`, `modelVersion` |

Testnet simplifications, marked in code with `// TESTNET:`: single operator key instead of
multisig; USDC is a mintable mock with faucet; withdrawal delay shortened. The tranche math,
margin accounting, and event schema are real — they are the things being demonstrated.

### 4.2 `engine/` — TypeScript (Node 20+)

The engine core is a **pure deterministic state machine**: `apply(state, command) → (state, events[])`.
All inputs — orders, cancels, oracle ticks, risk readings, clock ticks — arrive as sequenced
commands. No wall-clock reads, no randomness, no I/O inside the core. This buys us: exact
replayability (fairness artifact), property-based testing of margin/liquidation edge cases, and
the March-2020 replay demo as a first-class feature rather than a hack.

Modules:

- **intake** — REST + WS ingress; EIP-712 verification; nonce/expiry checks; rate limits.
- **risk gateway** — pre-trade checks: IM requirement from `margin`, OI cap, leverage cap by
  tier, reduce-only state.
- **book** — single-market price-time CLOB. In-memory sorted book, append-only command log in
  Postgres. Target: thousands of ops/sec — orders of magnitude beyond a 250-wallet cohort.
- **margin** — isolated margin per position.
  `IM = notional × baseIM(SPX) × gapCoeff(t) × tierMult(wallet)`, MM analogous with a floor.
  `gapCoeff` and `tierMult` are read from the latest signed risk readings; every margin check
  logs the exact inputs used (this is what makes tiers *product truth*).
- **funding** — hourly; clamp-bounded premium of mark TWAP vs index.
- **liquidation** — MM breach detection each oracle tick; normal mode: queue to liquidator with
  book-impact pacing (Playbook §2.8); reopen/stress mode: consume the sequencer plan (§4.3).
  Emits the signed explainer payload for every liquidation.
- **settlement batcher** — closes 24h epochs; nets PnL/funding/fees; computes state root;
  submits to `Settlement`; reconciles.
- **api/ws** — market data (book, trades, mark, funding), account channel, and the
  `/risk/v1/*` endpoint family (wallet tier + inputs, market state, reopen state, tranche
  state) per Playbook §2.4.

### 4.3 `risk/` — Python 3.11+

- **gap model** (`risk/gap`) — expected close-to-open gap distribution for SPX, conditioned on
  dark-period duration (17.5h weeknight vs 65.5h weekend), realized vol, and scheduled events;
  calibrated on ~30y of SPY daily data. Output: margin coefficient, recomputed every 4h during
  dark periods, signed and posted to `RiskRegistry` + engine. v0 is an honest empirical/Bayesian
  model with published methodology — feeds the Weekly Gap Report directly.
- **tier v0** (`risk/tier`) — behavioral tier A–E from observable features: sizing vs balance,
  drawdown response, time-in-position, liquidation history, funding behavior, tenure. Cold-start
  policy per Playbook: calibrated scorecard, presented as *provisional*, refit as testnet data
  accumulates; every tier ships with its named contributing inputs (explainability is the
  feature).
- **sequencer planner** — at each close: scan reopen-price scenarios, score liquidatable
  positions on (tier, contagion proximity, book depth), emit the deterministic clearing plan;
  after reopen, publish the ordering proof. Also provides the paced-clearing thresholds for
  in-session stress.
- **confidence** — composite of Pyth/Chainlink dispersion, staleness vs session state, and gap
  coefficient; below threshold → reduce-only. Note the elegant alignment: Pyth equity feeds go
  quiet outside market hours, which is precisely when the gap engine takes over.
- **model registry** — every reading and tier stamped with a model version; historical readings
  queryable (agents/auditors can replay decisions).

### 4.4 `apps/web/` — Next.js

Trading page (chart, book, ticket with live margin preview showing the tier × coefficient math,
positions, funding), account page (tier + named factors + history), PVault page (tranche NAVs,
deposit/withdraw, waterfall visual), public dashboards (gap coefficient live, confidence,
tier distribution, insurance/shield state), liquidation explainer feed, waitlist passport flow
(connect wallet → provisional tier from history). If the Density frontend arrives, it is
adapted here; otherwise built fresh — the API contract above doesn't change either way.

### 4.5 `bots/`

- **maker** — the PVault quoting bot: quotes around index with spread = f(confidence, gap
  coefficient, inventory). This *is* testnet liquidity, and its spread widening during dark
  periods is itself a demo of the thesis.
- **takers** — scripted flow archetypes (disciplined/reckless/random) to exercise tiers and
  produce a live book; used for the adversarial scenarios in Playbook month-4.
- **liquidator** — keeper that executes the liquidation queue against the book.

### 4.6 `sdk/` + MCP server — M3

Typed TS/Python clients generated from the engine API, `simulate()` against the real margin
engine, and the MCP server exposing `place_order`, `query_risk_state`, `simulate_margin`,
`lookup_behavioral_tier`, `read_liquidation_queue`, `read_tranche_state`. Cheap for us to build,
disproportionately on-thesis. Deferred until the API is stable (M3).

---

## 5. Key mechanics (V1 numbers, from the Playbook)

- Market: SPX-PERP. Collateral: mock USDC. Margin mode: isolated only.
- OI cap $1M equivalent; leverage cap 3x initial, tier-gated path to 6x.
- Gap coefficient cadence: every 4h during dark periods; continuous during sessions.
- Funding: hourly. Epochs: 24h (settlement + PVault NAV).
- PVault: 80/20 Senior/Junior target; Senior 8% floor / 12% target; Junior 48h lock;
  yield-curve enforcement (Senior yield → 0 when Junior < 15% of TVL); catastrophe mode
  = reduce-only + recap window.
- Reopen: 15-minute sequenced clearing window; up to 15% deferral rule on extreme prints.
- Confidence below threshold → reduce-only mode, on-chain visible.

---

## 6. Stack decisions (and why)

| Choice | Decision | Rationale |
|---|---|---|
| Contracts | Solidity + Foundry | Industry standard; best testing/fuzzing for margin math |
| Engine | TypeScript | Velocity for a solo+AI team; plenty fast for cohort scale; hot-path Rust port is a later optimization, not a V1 need |
| Risk | Python | The models are data science; pandas/scipy/sklearn ecosystem |
| Web | Next.js + lightweight-charts | Standard, fast to ship, Vercel-deployable |
| Data | Postgres (order/event log, accounts) + Redis (hot state, pub/sub) | Boring and correct |
| Chain | Base Sepolia | Per Playbook §5.1; Flashblocks make settlement UX snappy |
| Oracle | Pyth primary + Chainlink check | Per Playbook §5.2; testnet fallback: self-pushed feed clearly labeled (see Open Questions) |

---

## 7. Milestones

**M0 — Foundation (this week).** Repo + this spec frozen; SPY dataset pulled; first gap
statistics computed (input to both the margin engine and Weekly Gap Report #1).
*Done when: spec reviewed by founder; gap stats reproduce from script.*

**M1 — Core loop on Sepolia (~weeks 1–3).** Contracts v0 deployed; engine matching + isolated
margin + funding + basic liquidation; maker bot quoting; CLI/system test: deposit → trade →
funding → liquidation → withdraw, all replayable.
*Done when: an end-to-end scripted session runs against Sepolia and replays byte-identical.*

**M2 — Risk layer visible (~weeks 4–6).** Gap coefficient live on 4h cadence and *moving real
margin*; tier v0 wired into IM and shown with factors; signed liquidation explainers; frontend
trading page usable by an outsider.
*Done when: two wallets with different tiers pay measurably different margin for the same
position, and the UI shows why.*

**M3 — Showpieces (~weeks 7–9).** Sequenced reopen live + **March 2020 replay demo** (Perpify
vs naive venue, interactive); public dashboards; waitlist passport; MCP server v0; PVault
tranche flows end-to-end including a scripted Junior-wipe → catastrophe-mode drill.
*Done when: the COVID replay runs live in the browser and the catastrophe drill passes.*

**M4 — Closed testnet (~week 10+).** 50–100 invited wallets; points-free passport onboarding;
Weekly Gap Report cadence public; metrics collection for the investor demo (latency, spread
behavior across dark periods, tier differentiation stats).
*Done when: 50 external wallets have traded and the venue survived a real weekend reopen.*

Dates assume founder full-time + Claude doing the heavy implementation. Integration and polish
are where timelines slip; M1/M2 estimates already include test-writing time.

---

## 8. Environments, accounts, costs

| Item | Needed by | Cost |
|---|---|---|
| GitHub repo (private) | today | $0 |
| Base Sepolia RPC (Alchemy/QuickNode free tier) | M1 | $0 |
| Deployer wallet (fresh, testnet-only key) | M1 | $0 |
| Basescan API key (contract verification) | M1 | $0 |
| Sepolia ETH faucet | M1 | $0 |
| Vercel (web hosting) | M2 | $0 |
| Small VPS for engine+risk (or founder's Mac during dev) | M2–M3 | $0–20/mo |
| Domain (perpify.trade) | owned | — |

Total cash cost of the entire testnet phase: ≈ hosting pocket change.

---

## 9. Open questions (tracked, none blocking M0/M1)

1. **Pyth SPX/QQQ feed availability on Base Sepolia** — verify feed IDs early in M1. Fallback:
   engine-pushed index price from a market-data source, clearly labeled `TESTNET FEED`, behind
   the same OracleAdapter interface so the swap is invisible to the rest of the system.
2. **Index naming/licensing for mainnet** ("SPX" vs "US500"-style naming) — a mainnet legal
   question, not a testnet one; flag for the regulatory opinion workstream.
3. **Density codebase** — if it arrives, it accelerates §4.4 (frontend) and possibly ws infra.
   Nothing else depends on it. Confirm clean IP ownership before merging any of it.
4. **Engine hosting for the public phase** — single VPS is fine for M4; revisit if cohort >250.

---

## 10. What this buys the fundraise

After M3, the pitch is no longer a deck. It is: *"Here's a live venue. Watch two wallets pay
different margin for the same trade and see why. Watch the weekend coefficient climb. Watch
March 2020 clear without insolvency next to a naive venue that breaks. The methodology is
published; the logs are replayable. Your money buys audits, liquidity, and legal — the product
already exists."* That is a categorically different conversation than the one currently not
being taken.
