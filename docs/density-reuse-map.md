# Density → Perpify Reuse Map

**Audited:** July 27, 2026 · repos `density-exchange/{density-frontend, density-api, density-admin}` (last commits June 2024)
**Verdict: HARVEST, not adopt.** Lift specific components and protocol shapes into Perpify's fresh codebase. Do not fork any Density repo as a foundation.

## What Density actually was (confirmed)

A custodial Indian crypto-futures broker that passed every order through to Binance USD-M
futures. **No matching engine** (Binance matched), no internal settlement, no funding
computation, balance *mirror* rather than a real ledger, with an out-of-band reconciliation
module to stay honest against Binance. India-specific KYC/fiat rails throughout.

Perpify already has the parts Density never built (deterministic matching, margin engine,
conservation-law accounting, on-chain settlement). What Density has that we want is the
opposite layer: **battle-tested trader-facing surfaces and wire formats.**

## The harvest list (highest value first)

1. **Frontend WS message contract** — `density-api/websockets-api/websocket_util/types.go` +
   `app/broker_updates_v2/entity/entity.go`. The `{eventType, orderID, eventData}` envelope
   with `ORDER_TRADE_UPDATE` / `ACCOUNT_UPDATE` payload shapes, and the compact order-book
   wire schema `{bp,ap,s,…,b:[{P,Q,V,p}],a:[…]}` with precision aggregation.
   **Action (M1c): Perpify's engine ws/api module adopts these shapes** — battle-tested field
   sets, and any Density-style client code then ports with minimal change.
2. **Liquidation/margin bracket math (has tests)** —
   `density-api/workers/position_monitoring/monitoring/position_monitoring.go` +
   `entity/leverage_bracket.go`. Tiered maintenance-margin brackets, isolated & cross
   margin-ratio and liquidation-price closed forms, 0.95 liq trigger. Cross-check our
   `engine/src/margin.ts` against it now; primary reference for V3 cross-margin later.
3. **Position-risk fan-out pattern** — worker computes per-(symbol,user) risk into Redis;
   WS reads at 500ms cadence (`websockets-api/position_monitoring/web_socket.go`). Clean,
   scalable pattern for streaming liq-price/margin-ratio/tier to many clients.
4. **Order ticket UI + derivatives UX** — `density-frontend/src/components/Home/OrderForm/**`
   (MARKET/LIMIT/STOP/TP-SL/OCO logic in `OrderFormCalculator.tsx`),
   `UserActivities/**` (positions/orders tables incl. LiquidationPrice, MarginRatio,
   AddMargin, ClosePosition cells), `useLiquidationPrice.js`, `MarginRatio.js`,
   `Funding.jsx`. This is a real perps UI — the mechanics match ours 1:1.
5. **TradingView datafeed adapter pattern** — `TradingViewChart/{dataFeed,streaming}.ts`
   (see licensing below), and the order-book display pipeline design
   (`density-api/app/order_book/service/order_book_service.go`).
6. **Order/trade relational schema** — `app/futures_order/repository/ent/schema/*`:
   status enums, idempotency keys, per-symbol leverage/margin-type separation. Good DDL
   reference for the engine's Postgres log.

## The ignore list

Binance ingest/proxy/user-data-streams (our engine replaces the entire market-data spine);
SuperTokens email/OTP auth (→ wallet-connect); all India KYC/fiat (digio/idfy/instantpay,
PAN/IFSC, TDS); rewards/referral/leaderboard; disabled copy-trading (~5.7k LOC);
multi-symbol watchlist machinery (V1 is one market); the balance-mirror model (we have a
conservation-law ledger); the half-finished appV2/kratos migration; `CheckOrigin: true`
and token-in-query-string patterns (do not copy).

## Why harvest instead of adopt

The frontend's data layer is Binance-shaped end to end (market data, book, mark, funding,
klines — even liquidation inputs), and their own first-party book WS was never wired into
prod. ~25–30k of ~101k frontend LOC is CEX/India baggage. Typing is nominal (~60% untyped
JS, 548 `any`), tests near-zero (8 files), core files are large mixed-concern God files,
last touched June 2024. Widgets lift cleanly; the shell should be fresh (React 19 + RTK +
wagmi/wallet-connect), re-typed and tested as each piece comes in.

## Security findings (handle before any code is copied)

- **Committed credentials + PII in `density-api` git history:** two copies of
  `Binance_Testnet_Credentials.json` (~616 records each of email + API key/secret),
  real-looking secrets in `appV2/{broker,futures}/config/config.yaml`, Postgres/SuperTokens
  secrets in `docker-compose.yaml`, committed `load-test/.env`; `density-admin/.env`
  committed too. Testnet-scoped and the product is defunct, but: **tell the cofounder,
  rotate anything still live, treat the history as compromised, and never copy these files
  or their patterns into Perpify.**
- `db_dump/dump_local.sql` is a benign schema skeleton — no user rows (verified).
- **Licensing:** the vendored TradingView `charting_library` requires Perpify's own license
  (free, application process — apply early, weeks of lead time). The Highcharts depth chart
  requires a commercial license — swap to lightweight-charts/ECharts instead.

## Timeline impact

- **M1c (new, small): engine speaks the Density wire shapes** — adapter in the engine's
  ws/api layer. Cheap now, makes the M2 harvest mechanical.
- **M2 frontend: ~1.5–2 weeks saved** (ticket, tables, margin/liq UX, datafeed pattern
  ported instead of designed from scratch). Full-adoption savings were never real — the
  shell must be new regardless because auth + data spine change completely.
- Margin engine cross-check vs their bracket math: half a day, worth it immediately.

## Process notes

- Harvest execution waits for the cofounder's **written reuse permission** (one email).
  Until then this document only references paths; no Density code enters this repo.
- The audit used a temporary all-repos token — **delete it at github.com/settings/tokens
  now that the audit is done.** Re-cloning later takes a fresh token and five minutes.
