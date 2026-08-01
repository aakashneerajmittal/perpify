# Frontend Adoption — Density UI → Perpify

**Decision (Jul 31):** adopt Density's real production trading frontend and build on it,
rather than a from-scratch UI. Density's screen is a mature React 18 / Vite / MUI perps
interface (order form, positions, leverage/margin panels, charting). We repoint its data
feeds from Binance/Density to the Perpify engine, strip the CEX/India baggage, swap auth
for a testnet wallet, and add the gap-coefficient surface that is Perpify's differentiator.

## Grounding (verified, not assumed)

- Density frontend **installs** (2,772 pkgs) and **builds clean** (`vite build` exit 0) on
  our stack today — the base is viable, not broken.
- Its account+order websocket path — `/v1/order-and-account-updates?token={0}` — is
  **byte-identical to the Perpify engine's** (item 6 built this bridge deliberately). That
  stream connects by hostname change alone.
- Trade-screen API surface (the only endpoints we must serve; everything else is stripped):
  - Orders: `POST /v1/futures/order`, `/v1/futures/close-position`,
    `/v1/futures/close-all-positions`, `GET /v1/futures/orders`, cancel
  - Account: `/v1/account/details`, `/position`, `/symbol-leverage`, `/leverage-brackets`,
    `/margin-type`, `/position/margin`
  - Market: `/fapi/v1/exchangeInfo` (symbol filters), depth snapshot; live via our
    `/marketDataStream` + `/v1/ws/order-book`
- Source vendored at `apps/trade/` (licensed TradingView `charting_library` and build cruft
  excluded). `LOCAL` env repointed to the engine in `Base/index.js`.

## Plan (sequential, like the backlog)

1. **[done] Vendor + repoint config.** Density frontend in `apps/trade`; `LOCAL` env →
   Perpify engine (`VITE_PERPIFY_ENGINE` / `_WS` overrides).
2. **Boot against the engine.** `npm install` + `vite dev`; get the app serving and the
   account/order WS connected to the engine (testnet address as token). Expect it to land on
   the login guard first — step 3 removes that.
3. **Auth → testnet wallet.** Replace SuperTokens email/OTP with a burner/wallet-connect
   session (the audit found guard reach is shallow: `ProtectedRouteWrapper`, `AuthRouter`,
   the WS `?token=` and the axios instance). Generate/allow an address, use it as the token.
4. **Market-data repoint.** Point the market-data layer (`WebSocketModule` /
   `useHandleBinanceSocketSubs`) at our `/marketDataStream` (mark/index/**gc**) and the book
   at `/v1/ws/order-book`. Map our aggregated shape into their `OrderBook` reducer.
5. **Order submit repoint.** Their order form posts `POST /v1/futures/order`. Add a small
   REST intake to the engine mirroring that shape (dispatches a `place_order`), OR adapt the
   submit to our ws `place_order`. REST-on-engine keeps their form unchanged — preferred.
6. **Disable non-core features — DO NOT delete (founder directive Jul 31).** Keep every
   feature in the codebase — News, Rebate, Referral, Onboarding, KYC, fiat, copy-trading,
   API mgmt, leaderboard, rewards, multi-symbol watchlist. For the testnet phase they are
   switched OFF via `apps/trade/src/config/perpifyFeatures.js`: hidden from navigation and
   route-gated behind a `<ComingSoon/>` wrapper, with all code + assets retained. Flip a
   flag to `true` to bring any feature back — nothing to rebuild. Only the SPX-PERP trade
   screen (+ its account plumbing) ships live. (No deletion; assets kept.)
7. **Chart.** Swap the licensed TradingView Charting Library for a free chart
   (lightweight-charts) fed from `/marketDataStream`. Removes the license from the path;
   apply for the TradingView license only if we want their advanced charts in production.
8. **Perpify brand + the differentiator.** Retheme (dark, blue accent, Perpify marks) and
   add the **gap-coefficient panel** — prominent, "pricing the dark", with the live margin
   breakdown (base × gap × tier) and a liquidation price that moves with the coefficient.
   This is the one thing Density's UI never had and the reason an investor leans in.
9. **Run live + deploy.** `vite dev` on the founder's Mac against the running venue for
   iteration; then a public deploy (static host + engine tunnel/VPS) so an investor trades
   it from their own laptop.

## Status (Aug 1) — the trade loop is LIVE and verified

All nine steps are done; the SPX-PERP screen is a working, tradeable testnet product,
verified end-to-end headless (Chromium, zero page errors) at each step:

- **Boot + render** — app serves, trade screen paints (boot crashes fixed: `getSupportChat`
  `fcWidget.on` guard, third-party `<script>`s removed, analytics init guarded).
- **Market data** — live SPX-PERP mark/index/**gap coefficient** + aggregated book from the
  engine (`usePerpifyMarketData` → same redux shapes the header/book already read).
- **Symbol config** — static `SPX-PERP` exchange-info injected (precision/tick/step/min-notional)
  so price, book, order form, positions all populate. Default leverage + isolated margin-type
  seeded (normally REST-sourced) so the order button enables and fills render.
- **Chart** — open-source Lightweight Charts, live from `/marketDataStream`, amber when the gap
  coefficient is elevated. (Licensed TradingView lib stays out until production.)
- **Auth → burner wallet** — "Login to Trade" mints a `0x` address in localStorage
  (`config/perpifySession`); `GENERATE_TOKEN` returns it; the account WS connects with
  `?token=<address>`; engine `--demo` funds **$100k (tier B)** on first connect. Balance is
  derived from the WS `ACCOUNT_UPDATE` (no REST account endpoint).
- **Order placement** — order form → `place_order` over the account WS (market = marketable
  IOC crossing the book, ±5% slippage cap; limit = GTC). Engine `ORDER_TRADE_UPDATE` now emits
  the Binance single-letter fields the frontend reads, so fills map to positions with entry/
  size/liq/PnL. Verified: BUY → Positions(1), balance drops.
- **Close** — "Close" / "Close All" send `market_close` over the WS; the exit modal + cancel
  route through `perpifyWsBridge`. Verified: BUY → Close → Positions(0), balance returns
  (diff = fees + slippage).
- **Rebrand** — every visible label reads **USDC**; no "USDT"/"Density" on the trade surface.
- **Feature flags** — nav shows only Trade + Portfolio; tabs only Chart + Order Book; News,
  Market/multi-symbol, Leaderboard, Assets/fiat hidden (code kept — flip a flag in
  `perpifyFeatures.js`).

Remaining before an investor URL: retheme polish (colors/logo), TP-SL & stop orders (declined
cleanly for now), and the public deploy (static host + engine tunnel/VPS).

## Running the demo (verified procedure)

Engine (clean two-sided book — **use `--fresh`**, else a long command log skews the maker
one-sided and market orders can't fill):

```
cd engine && npx tsx src/main.ts --demo --offline --fresh --origins=http://localhost:5199,null
```

Frontend — production build served on :5199 (matches the origin above):

```
cd apps/trade && npx vite build && python3 -m http.server 5199 --directory build
```

For live visual iteration use `npx vite dev` instead (serves on :5173 — then start the engine
with `--origins=http://localhost:5173,null`). For a deployed demo, set `VITE_PERPIFY_WS` /
`VITE_PERPIFY_ENGINE` to the engine's public URL before `vite build` (defaults to
`ws://localhost:8787` / `http://localhost:8787`).

Then open the URL → **Login to Trade** (funds $100k) → enter a size (USDC notional) → **BUY/SELL**
→ position appears with live PnL → **Close**. Everything streams over the one account WebSocket.

## Where the work happens

Correctness-critical, headless-testable pieces (engine REST intake, data mappers) are done
in the cloud and pushed. Visual iteration (theme, layout, the gap panel) is best done with
`vite dev` running live — on the founder's Mac, directed here, or in the cloud verified by
headless screenshots.

## Notes

- Testnet only throughout. Address-as-token auth is the documented stub; production swaps in
  wallet-signature auth without changing the screens.
- The single-file `apps/web/index.html` from the first pass stays as a lightweight fallback /
  reference for the gap-panel design; the Density UI in `apps/trade` is the real product.
