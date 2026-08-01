# Deploy — Perpify testnet demo (Railway engine + Netlify frontend)

Two pieces, deployed from the same GitHub repo:

- **Engine** → **Railway** (always-on WebSocket server; builds `Dockerfile.engine`).
- **Frontend** → **Netlify** (static build of `apps/trade`).

```
   investor browser ──https──▶  perpify.netlify.app          (Netlify: static frontend)
                    ──wss────▶  <name>.up.railway.app        (Railway: the engine)
```

The frontend talks to the engine over one WebSocket (orders, fills, account, market data).
There is no database — the engine is the whole server. Both platforms build straight from the
repo and give you TLS (`https`/`wss`) automatically; no certificates to manage.

Do these in order. **Engine first** — you need its URL to build the frontend.

---

## Part A — Engine on Railway (~5 min)

1. Go to **railway.com** → sign in with GitHub → **New Project** → **Deploy from GitHub repo**
   → pick `aakashneerajmittal/perpify`.
2. Railway reads `railway.json` and builds `Dockerfile.engine` automatically. Wait for the
   first deploy to go green (it runs `npm install` then starts the engine).
3. **Settings → Networking → Generate Domain.** Railway gives you a URL like
   `perpify-production-xxxx.up.railway.app`. **Copy it** — this is your engine host.
4. **Variables → New Variable:** add
   `ALLOWED_ORIGINS = https://perpify.netlify.app,null`
   (use the exact Netlify URL you'll set in Part B — naming the Netlify site `perpify` makes it
   `perpify.netlify.app`). Railway redeploys automatically.
5. Check it's alive: open `https://<your-railway-domain>/` in a browser — you should see
   `{"service":"perpify-engine","ok":true,...}`.

Railway injects `PORT`; the engine reads it. It runs `--demo --offline --fresh` (funds every
visitor $100k, no chain calls, clean two-sided maker book on each restart).

---

## Part B — Frontend on Netlify (~5 min)

1. Go to **netlify.com** → **Add new site → Import an existing project** → GitHub →
   pick `aakashneerajmittal/perpify`.
2. Netlify reads `netlify.toml` (base `apps/trade`, build `vite build`, publish `build`) — leave
   the build settings as detected.
3. **Site configuration → Environment variables → Add** these two (from Part A step 3):
   - `VITE_PERPIFY_WS` = `wss://<your-railway-domain>`
   - `VITE_PERPIFY_ENGINE` = `https://<your-railway-domain>`
4. **Site configuration → Change site name** → set it to `perpify` (so the URL is
   `perpify.netlify.app` — matching what you put in `ALLOWED_ORIGINS`).
5. **Deploys → Trigger deploy → Deploy site** (so the build picks up the env vars). Wait for green.

---

## Part C — Verify

Open `https://perpify.netlify.app`:

- The SPX-PERP price and chart are moving → the market-data WebSocket is connected.
- Click **Login to Trade** → **Available Balance** shows **100,000 USDC**.
- Place a small **BUY** → a position appears with live PnL → **Close** → it unwinds.

That's the full loop, live, on a link you can send an investor.

---

## Troubleshooting

- **Price never moves / login spins forever.** `ALLOWED_ORIGINS` on Railway doesn't match the
  Netlify URL exactly (scheme + host, no trailing slash). Open the browser console — a `403` on
  the WebSocket confirms it. Fix the variable on Railway; it redeploys.
- **Frontend still hits localhost.** The Netlify env vars weren't set before the build. Set them,
  then **Trigger deploy** again (they're baked in at build time).
- **Orders won't fill.** The maker book drifted one-sided. On Railway, **Deployments → Restart** —
  the engine boots `--fresh` with a clean two-sided book.
- **Railway free usage runs out.** The engine is tiny; the Hobby plan (~$5/mo) keeps it always-on
  with no cold starts — worth it so an investor never hits a spun-down server.

---

## Alternative — your own VPS (instead of Railway)

Run the engine container behind Caddy for `wss` TLS (`deploy/Caddyfile` handles certificates):

```
docker build -f Dockerfile.engine -t perpify-engine .
docker run -d --name perpify-engine -e ALLOWED_ORIGINS="https://perpify.netlify.app,null" \
  -e PORT=8787 -p 8787:8787 perpify-engine
docker run -d --name caddy --network host \
  -v $PWD/deploy/Caddyfile:/etc/caddy/Caddyfile -v caddy_data:/data caddy:2
```

Point `engine.yourdomain.com` DNS at the host, put that host in the Netlify env vars, and add the
Netlify URL to `ALLOWED_ORIGINS`. Everything else is the same.

## Notes

- **Testnet only.** Burner-wallet auth + $100k demo funding are the documented testnet stubs; real
  wallet-signature auth and real collateral replace them for mainnet without UI changes.
- **Restart = clean venue.** The engine is in-memory and deterministic; `--fresh` gives a clean
  book every restart. One small instance handles demo load comfortably.
