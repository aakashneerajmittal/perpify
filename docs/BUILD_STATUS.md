# Perpify — Build Status: What's Built & What's Left

**Updated:** August 2, 2026 · **Live demo:** demo.perpify.trade · **Repo:** `main`

This is a plain-language map of everything built so far and everything still to build, split
into **backend** and **frontend**. It's meant to be readable by a non-technical founder and
useful to an engineer. Roadmap labels (M2/M3/M4) match the Testnet V1 Architecture doc.

---

## Where we are in one paragraph

Perpify is a **live, tradeable perpetual-futures venue** you can use in a browser today. It
runs **six markets** — the S&P 500 index perp plus single-stock perps on the five largest US
companies (NVDA, AAPL, MSFT, GOOGL, AMZN) — priced with Perpify's AI **gap coefficient** and
**behavioral tiers**. A visitor connects a wallet, gets $100k testnet USDC, and can open
positions across markets from one balance, see live margin that moves with tier × gap, get
liquidated with a signed explainer, and close out. The hard, differentiated core — a
deterministic matching engine that can't lie about money, the gap model, tiers, and a
production-grade trading UI — **exists and is deployed.** What remains is mostly (a) turning
on things that are stubbed for the demo (real wallet-signature login, on-chain settlement in
the live path, conditional orders) and (b) the funded-roadmap showpieces (sequenced reopen /
March-2020 replay, public dashboards, PVault yield vaults, SDK/MCP).

---

## The system in one picture

```
  Browser (apps/trade)  ──WebSocket──▶  Engine (engine/, TypeScript)  ◀──signed readings── Risk (risk/, Python)
  React/Vite/MUI                        deterministic matching core                        gap model · tiers
  wallet · chart · book                 6 markets · margin · funding                        confidence · sequencer
  order ticket · positions              liquidation · event log                                    │
        │                                     │  epoch roots / settlement                         │ signed
        │                                     ▼                                                    ▼
        └──────────────────────────▶  Contracts (contracts/, Solidity on Base Sepolia)  ◀──────────┘
                                       vault (custody) · settlement · oracle · risk registry · PVault
        Bots (bots/): maker + takers keep every market's book alive
```

**One line on trust:** everything the venue does is signed, logged, and **replayable** — an
auditor can recompute the entire state from the order log. That's the V1 trust story; math
proofs are a funded-roadmap upgrade.

---

## A. BACKEND

### A.1 Built ✅

| Area | What's built | Notes |
|---|---|---|
| **Matching engine core** | Deterministic `apply(state, command) → events` state machine. Price-time order book (CLOB), isolated-margin accounting, funding, liquidation, hash-chained event log, byte-identical replay. | `engine/src/{core,book,margin,state,fixed}.ts`. 41 unit tests + fuzz + soak green. |
| **Multi-market venue (NEW)** | 6 independent markets (SPX + NVDA/AAPL/MSFT/GOOGL/AMZN): per-market book, oracle, mark, gap coefficient. **One shared balance, isolated position per market.** Commands route by market; liquidation/funding/oracle scoped per market. | Rebuilt this phase. Conservation law now sums across all markets. `Perpify_MultiMarket_Phase2.md`. |
| **Money-conservation guarantee** | The ledger cannot lie: deposits − withdrawals always equals cash + open PnL, asserted after every command; the venue halts rather than drift. | This is the core "trust the engine" property. |
| **Behavioral tiers (v0, demo)** | A–E tiers with a margin multiplier + named explainability factors; two wallets pay measurably different margin for the same trade. | Currently **derived deterministically from wallet address** as a stand-in. `wire/server.ts` `demoTierForAddress`. |
| **Gap coefficient model (gap-v0.1)** | Calibrated on ~31y of SPY data; computes the live "price the dark" margin coefficient from the real US market clock (ramps into nights/weekends). Ported Python→TS so it runs in the engine with no Python. | `engine/src/risk/gapCoefficient.ts` + `risk/gap/`. Backtested (99% tail breach 2.5% vs 4.8% static). |
| **Liquidation + signed explainer** | MM-breach detection each tick; synthetic close through the book; insurance-fund backstop inherits unfillable positions (keeps OI balanced); every liquidation emits a signed, replayable explainer (tier, gap, confidence, equity<MM, proof hash). | `engine/src/core.ts`. |
| **Density wire protocol** | Binance-shaped WebSocket dialect the frontend speaks: market data, order book, per-user account/order stream + order intake, gap coefficient rides the price stream. | `engine/src/wire/{server,bus,density}.ts`. |
| **Maker + taker bots** | Per-market maker quoting around index with **spread that widens with the gap coefficient** (the thesis, visible on the book) + scripted takers keeping each book alive. | `engine/src/bots/`. |
| **Smart contracts (Base Sepolia)** | 7 contracts deployed + smoke-tested: `PerpVault` (custody), `Settlement` (epoch roots), `OracleAdapter`, `RiskRegistry` (signed readings/explainers), `PVaultTranches`, `MockUSDC`, `Operated`. | `contracts/`. Epoch 1 settled on-chain, root verified byte-identical. |
| **Engine ↔ chain pipeline** | Epoch settlement batching, state-root posting, risk-reading posting to the registry — exists and was demonstrated on Sepolia. | `engine/src/chain.ts`, `run-epoch-cycle.ts`. |
| **Deploy infra** | Engine as a Docker service (Render), frontend on Netlify, auto-deploy from `main`, health endpoint, wss/TLS runbook. | `Dockerfile.engine`, `render.yaml`, `netlify.toml`, `docs/DEPLOY.md`. |

### A.2 To build 🔜

| Priority | Item | Why / what it unlocks |
|---|---|---|
| **High** | **Real EIP-712 wallet-signature auth** — replace the testnet "wallet address = token" stub with signed orders (nonce + expiry), verified in the engine intake. | Turns the demo into a real DEX; today login is a burner/address stub. Code marked `real EIP-712 sig lands with production auth`. |
| **High** | **On-chain settlement in the live path** — the live demo engine runs `--offline` (off-chain) for reliability; wire the deployed engine to Base Sepolia so deposits/withdrawals/epochs settle on-chain live. | Contracts + pipeline exist and were tested; they're just not in the live demo loop yet. |
| **High** | **Conditional orders (TP/SL, stop, stop-limit)** — engine support for take-profit / stop-loss brackets and stop triggers. | Frontend already declines these cleanly ("coming soon"). Marked M2. |
| **Medium** | **Real behavioral tier inference** — score tiers from actual on-chain/trading history (sizing, drawdown response, tenure, liquidation history) instead of address-derived; refit as testnet data accumulates. | `risk/tier/` scaffold exists; the live tier is provisional. |
| **Medium** | **Per-symbol gap calibration** — each stock currently shares the SPX gap curve (same session clock). Calibrate per-underlying gap distributions (a stock gaps differently than the index). | More credible per-market margin; the model version stamping is already in place. |
| **Medium** | **Confidence / reduce-only from live oracles** — Pyth + Chainlink dispersion/staleness driving the reduce-only flag (the engine honors the flag; the live feed isn't wired). | Architecture §4.3. Elegant: equity feeds go quiet off-hours exactly when gap takes over. |
| **Medium** | **Realized-PnL ledger + intake API** — per-fill/per-position lifetime realized PnL and the REST intake API. | Marked M2 in `wire/density.ts` (`rp`/`accumulatedRealized` are stubbed at 0). |
| **M3** | **Sequencer / sequenced reopen** — deterministic clearing plan at reopen (scored by tier, contagion, depth) + the **March-2020 replay** engine. | The headline showpiece. `queueRank` is stubbed `null` (normal mode) today. |
| **M3** | **PVault tranche flows** — wire the Senior/Junior yield-vault contract to the engine + a catastrophe-mode drill. | Contract exists; not connected to engine/UI. |
| **M3** | **SDK + MCP server** — typed clients + `place_order`/`simulate_margin`/`lookup_tier`/`read_liquidation_queue` tools. | `sdk/` is empty scaffolding. On-thesis, cheap once the API is stable. |
| **Post-funding** | Proof system (zk or optimistic), professional audits, mainnet deploy, multisig operator, real USDC, HFT-grade latency (Rust hot-path). | Explicitly gated on the raise. |

---

## B. FRONTEND

Built on **Density's real production trading frontend** (React 18 / Vite / MUI), repointed to
the Perpify engine and rebranded. Density's full feature set is **kept in the code** and
switched off with feature flags (see Section C) — nothing was deleted.

### B.1 Built ✅

| Area | What's built | Notes |
|---|---|---|
| **Live trade screen** | Perpify-branded SPX + stock trading screen: live mark/index, moving chart, order book, 24h stats, live funding, order ticket with live margin preview. | `apps/trade`. Full loop verified live. |
| **Market switching (NEW)** | Native "Select Market" drawer lists all 6 markets with live prices, search, favorites; picking one repoints the whole screen (price, chart, book, funding, gap). | This phase. Per-symbol data streams + order routing. |
| **Wallet connect** | Connect-wallet modal (injected / Coinbase / WalletConnect / etc.) **and** an instant **demo wallet** funded $100k testnet USDC. | `components/Wallet/`. Real signature auth is the backend to-build. |
| **Gap Coefficient panel** | The differentiator on the header — live per-market coefficient, turns amber and reads "pricing the dark" when elevated; a "preview weekend" toggle to demo it any time. | `MarketSegment/GapCoefficient.tsx`. |
| **Behavioral tier card** | Shows the trader's tier, margin multiplier ("Margin ×1.20 up to 2×"), and the named factors — "the venue prices your history, not a static table." | `components/Tier/`. |
| **Order placement + positions** | Market + limit orders over the WebSocket; positions table with entry, size, **liquidation price**, live PnL, margin — across multiple markets at once. | Verified: NVDA + AAPL positions open simultaneously from one balance. |
| **Liquidation explainer modal** | Signed "why you were liquidated" modal (tier, gap coeff, oracle confidence, equity<MM, proof hash). | `components/Liquidation/`. |
| **Position close** | Per-position close and Close-All; per-market isolated close verified (closing NVDA leaves AAPL open). | |
| **Demo controls** | "Simulate gap" (force a reopen gap → liquidation → explainer) and "preview weekend" (elevate the gap coefficient) — for live storytelling. | Testnet-only theatre. |
| **Brand + resilience** | Perpify logo + brand-blue accent (#4F8EFF); all labels read USDC (no "Density"/"USDT"); crash-proof error boundary + boot fallback so an investor never sees a blank page. | |

### B.2 To build 🔜

| Priority | Item | Why / what it unlocks |
|---|---|---|
| **High** | **Real wallet-signature login UX** — sign-in + per-order signing flow once the backend EIP-712 auth lands (replaces the burner). | Pairs with the backend auth item. |
| **High** | **TP/SL & stop-order ticket** — the order-form UI for brackets/stops (currently declined "coming soon"). | Pairs with backend conditional orders. |
| **Medium** | **Account / portfolio page** — tier + factor history, balances, order history, realized PnL views. | Density's account page is in code (flagged off); needs Perpify wiring + the realized-PnL backend. |
| **Medium** | **Copy tweaks for multi-market** — a couple of strings still say "S&P 500 perpetuals" (e.g., the connect-wallet subtitle) now that there are 6 markets. | Small polish. |
| **Medium** | **Public dashboards** (future `gaps.perpify.trade`) — live gap coefficient, confidence, tier distribution, venue/insurance state, liquidation feed. | Architecture §4.4; backlog item 13. A public, no-login proof surface. |
| **M3** | **March-2020 replay UI** — interactive "Perpify vs a naive venue" side-by-side replay. | The fundraising showpiece front-end; pairs with the backend sequencer. |
| **M3** | **Waitlist passport flow** — connect wallet → provisional tier from history → onboarding. | Backlog item; feeds the closed-testnet cohort. |
| **M3** | **PVault page** — tranche NAVs, deposit/withdraw, waterfall visual. | Pairs with backend tranche flows. |
| **Later** | **Mobile** + re-enabling the parked Density features (News, Rewards, Referral, Leaderboard, Signal/copy trading, fiat) as the product grows. | All present in code behind flags. |

---

## C. Built but switched OFF (kept in code)

Density shipped a full exchange; for the testnet we hid everything that isn't the core trade
story, without deleting it. Flip a flag in `config/perpifyFeatures.js` to bring any of these
back:

- **Off now:** News, Rebate, Referral, Onboarding tour, Rewards, Leaderboard, KYC, Fiat
  (deposit/withdraw, bank accounts), Signal/copy trading, API management, multi-symbol
  watchlist.
- **On now:** Trade, Positions, Portfolio (read-only), Settings (basic).

This is an asset, not debt: much of the "to build" frontend list is really "re-enable + wire
to our engine," not "build from scratch."

---

## D. Suggested sequencing

1. **Finish M2** (turn the demo into a real DEX): real wallet-signature auth (BE+FE) →
   on-chain settlement in the live path → conditional orders (TP/SL) BE+FE → real tier
   inference. These make the live venue genuinely trustless-ish and complete the trading loop.
2. **M3 showpieces** (the fundraise closers): sequenced reopen + March-2020 replay
   (BE+FE) → public dashboards → PVault flows → SDK/MCP.
3. **M4 closed testnet:** invite 50–100 wallets, Weekly Gap Report cadence, collect the
   differentiation metrics for the investor demo.
4. **Post-raise:** audits, proof system, mainnet, multisig, latency hardening.

---

## E. Where things live / how to run

- **Engine:** `engine/` (TypeScript). Run: `npx tsx src/main.ts --demo --offline --fresh`.
  Tests: `npx vitest run`. Typecheck: `npx tsc --noEmit`.
- **Frontend:** `apps/trade/` (React/Vite). Build: `npx vite build`. Config: `config/perpifySymbol.ts` (markets), `config/perpifyFeatures.js` (flags).
- **Risk models:** `risk/gap/` (calibrated gap model + data), `risk/tier/` (tier scaffold).
- **Contracts:** `contracts/` (Solidity, Base Sepolia).
- **Bots:** `bots/` + `engine/src/bots/`.
- **Deploy:** `Dockerfile.engine`, `render.yaml`, `netlify.toml`, `docs/DEPLOY.md`.
- **Roadmap docs (Perpify project):** Architecture (Testnet V1), Sequential Backlog, Product
  Playbook, MultiMarket Phase 2, this Build Status.
