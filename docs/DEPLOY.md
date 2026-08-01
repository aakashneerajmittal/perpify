# Deploy — Perpify testnet demo (send an investor a link)

Two pieces, deployed independently:

1. **Frontend** — a static build (`apps/trade/build/`) served from any static host
   (Vercel, Netlify, Cloudflare Pages, S3+CloudFront, GitHub Pages).
2. **Engine** — the matching venue (`Dockerfile.engine`) on any container host
   (Fly.io, Render, Railway, a VPS). Browsers reach it over **wss** (TLS), so it sits behind
   a TLS terminator — `deploy/Caddyfile` does this with automatic certificates.

```
   investor browser ──https──▶  app.perpify.trade      (static frontend)
                    ──wss────▶  engine.perpify.trade   (Caddy TLS ─▶ engine :8787)
```

The frontend connects to the engine over one WebSocket (orders, fills, account, market data).
There is no separate backend/database — the engine is the whole server.

## 1. Engine

Build (from repo root) and run:

```
docker build -f Dockerfile.engine -t perpify-engine .
docker run -d --name perpify-engine \
  -e ALLOWED_ORIGINS="https://app.perpify.trade,null" \
  -e PORT=8787 -p 8787:8787 \
  perpify-engine
```

`ALLOWED_ORIGINS` **must include the frontend's exact origin** (scheme + host, no path) or the
browser WebSocket upgrade is rejected with 403. Keep `null` too (covers non-browser clients).
The container runs `--demo --offline --fresh`: every connecting address is funded $100k, no chain
calls, and the maker book starts clean two-sided (see below for why `--fresh` matters).

Verified: the image boots, funds a connecting wallet, and fills a market order end-to-end.
(In the cloud sandbox the image was validated with vendored deps; `npm install` of the three
deps — ws, ethers, tsx — runs normally on a real host/CI.)

### TLS (wss) with Caddy

Point `engine.perpify.trade` DNS at the host, then run Caddy with `deploy/Caddyfile`:

```
docker run -d --name caddy --network host \
  -v $PWD/deploy/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data caddy:2
```

Caddy fetches a Let's Encrypt cert automatically and proxies `wss://engine.perpify.trade` →
`ws://127.0.0.1:8787`. On Fly/Render/Railway you can skip Caddy — they terminate TLS for you;
just expose port 8787 and use the platform's `https/wss` URL.

## 2. Frontend

Build with the engine's **public** URLs embedded (defaults to `localhost:8787` if unset):

```
cd apps/trade
VITE_PERPIFY_WS="wss://engine.perpify.trade" \
VITE_PERPIFY_ENGINE="https://engine.perpify.trade" \
npx vite build
# deploy the build/ directory to your static host
```

(These are injected at build time via `vite.config.js` → `define`. Verified: the built bundle
contains the wss URL, not the localhost fallback.)

## 3. Sanity checks after deploy

- Open the frontend URL → the SPX-PERP price and chart are moving (market-data WS connected).
- Click **Login to Trade** → **Available Balance** shows 100,000 USDC (account WS + demo funding).
- Place a small **BUY** → a position appears; **Close** → it unwinds. If orders don't fill,
  the engine's maker book is one-sided — restart the engine (it boots `--fresh`).
- If the price never moves or login spins: `ALLOWED_ORIGINS` doesn't match the frontend origin
  (check the browser console for a 403 on the WebSocket).

## Notes

- **Restart the engine to reset.** `--fresh` skips replaying the command log, so each restart is a
  clean venue with a two-sided maker book. A long-running engine that replays a big log can drift
  the maker one-sided (orders stop filling) — restarting fixes it.
- **Testnet only.** Burner-wallet auth and $100k demo funding are the documented testnet stubs;
  real wallet-signature auth and real collateral replace them for mainnet without UI changes.
- **Single region is fine** for a demo. The engine is in-memory and deterministic; one small
  instance handles demo load comfortably.
