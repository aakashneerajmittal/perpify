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
positions across markets from one balance, place **market / limit / stop / TP-SL** orders, see
live margin that moves with tier × gap, get liquidated with a signed explainer, and close out.
The hard, differentiated core — a deterministic matching engine that can't lie about money, the
gap model, tiers, and a production-grade trading UI — **exists and is deployed.**

**As of Aug 3, the full M2 + M3 backlog is built.** Conditional orders (TP/SL/stop), the
realized-PnL ledger, live behavioral-tier inference, confidence/reduce-only, and per-symbol gap
calibration are all live. The M3 showpieces are done: the sequenced-reopen **March-2020 replay**,
the public **risk dashboard**, the shareable **trader passport**, the **PVault** structured-
liquidity page, and the **SDK + MCP** server. **EIP-712 signed-order auth** is live in the engine
(verify-if-present) with a wallet-signing frontend built behind a flag. The only thing not
literally "on" is **live on-chain settlement**, which is fully wired and one dashboard toggle away
(`PERPIFY_ONCHAIN=1` + an operator key — see `docs/ONCHAIN_SETTLEMENT.md`); it's off by default so
a slow testnet RPC can't stall the demo. What remains is genuinely **post-funding**: proofs,
audits, mainnet, latency hardening.

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

### A.2 Recently shipped (M2 + M3) ✅

| Was | Item | Now |
|---|---|---|
| High | **EIP-712 signed-order auth** — sign the canonical Order struct (Base Sepolia domain, verifyingContract = deployed Settlement); engine recovers the signer, matches it to the owner + connection, then admits. Verify-if-present, so unsigned demo orders are unchanged. | **Live in engine** (`auth/eip712.ts`, 11 tests incl. real-socket integration). FE signing built behind the `signedOrders` flag. |
| High | **On-chain settlement in the live path** — deposit scan + epoch state-root posting + risk-reading posting. | **Flip-ready**: `PERPIFY_ONCHAIN=1` + operator key turns it on from the Render dashboard, crash-safe, instant rollback. `docs/ONCHAIN_SETTLEMENT.md`. Off by default so a slow RPC can't stall the demo. |
| High | **Conditional orders (TP/SL, stop, stop-limit)** — per-market armed triggers fired on the mark crossing; reduce-only closes. | **Done** (`core.fireTriggers`, `triggers.test.ts`). |
| Medium | **Real behavioral tier inference** — liquidations, realized-PnL discipline, turnover-vs-funding, tenure; provisional cold-start below an activity floor. | **Done** (`risk/tierScore.ts`, live re-scoring pushes fresh SESSION_INFO). |
| Medium | **Per-symbol gap calibration** — single stocks gap wider than the index (vol-scaled). | **Done** (`SYMBOL_GAP_SCALE`, per-market signed readings). |
| Medium | **Confidence / reduce-only** — low-confidence markets block new exposure, allow closes. | **Done** (confidence readings + reduce-only chip in UI). |
| Medium | **Realized-PnL ledger + intake** — lifetime realized PnL per account, streamed on ACCOUNT_UPDATE. | **Done** (`accumulatedRealized`; surfaced in the UI next to unrealized P&L). |
| M3 | **Sequencer / sequenced reopen + March-2020 replay** — deterministic clearing plan scored by tier/contagion/depth. | **Done** (`risk/sequencer.ts`, `replay-mar2020.ts`; 65% less bad debt vs a naive venue). |
| M3 | **PVault tranche flows** — Senior/Junior waterfall (profit yield curve + reserve; loss → junior → reserve → senior, wipe + catastrophe + insolvency). | **Done** (`vault/tranches.ts`, 13 tests + randomized invariant sweep; live on `/vaultStream`). |
| M3 | **SDK + MCP server** — typed client + agent tools. | **Done** (`sdk/`, stdio-tested). |

**Still ahead — post-funding only:** proof system (zk or optimistic), professional audits, mainnet
deploy, multisig operator, real USDC, HFT-grade latency (Rust hot-path). Explicitly gated on the raise.

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

### B.2 Recently shipped ✅

| Was | Item | Now |
|---|---|---|
| High | **TP/SL & stop-order ticket** — order-form UI for brackets/stops, wired to the conditional-orders engine. | **Done** (arms reduce-only triggers alongside the entry). |
| High | **Wallet-signature order signing** — sign each market/limit order with a real connected wallet. | **Built**, behind the `signedOrders` flag (viem, mirrors the engine domain). Off by default so the demo burner path is untouched; flip on to require real-wallet signatures. |
| Medium | **Account / portfolio surfacing** — lifetime realized PnL next to unrealized Total P&L. | **Done** (`RealizedPnl.tsx`, streamed from the engine ledger). |
| Medium | **Copy tweaks for multi-market** — connect-wallet subtitle and other single-market strings. | **Done.** |
| Medium | **Public risk dashboard** — live gap coefficient + confidence + session state across all six markets, no login. | **Done** (`/dashboard.html`). |
| M3 | **March-2020 replay UI** — interactive "Perpify vs a naive venue" side-by-side. | **Done** (`/replay.html`). |
| M3 | **Waitlist trader passport** — connect wallet / paste address → provisional tier + factors → enter the testnet. Shareable, deep-linkable; tier is a byte-for-byte match to the engine's cold-start function. | **Done** (`/passport.html`). |
| M3 | **PVault page** — live tranche NAVs/TVL/reserve + faithful deposit & catastrophe-drill previews. | **Done** (`/pvault.html`, reads `/vaultStream`). |

**Still ahead — later / post-funding:** mobile, and re-enabling the parked Density features (News,
Rewards, Referral, Leaderboard, Signal/copy trading, fiat) as the product grows — all present in
code behind flags.

The four public proof-surface pages (`/dashboard.html`, `/replay.html`, `/passport.html`,
`/pvault.html`) are cross-linked into one no-login tour an investor can click through.

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
