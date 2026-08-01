# Perpify Trading UI

A self-contained trading interface for the SPX-PERP testnet venue. One HTML file, no build
step, no framework — it connects to the engine's Density-dialect websockets and lets a user
fund a testnet wallet, trade, and watch the gap coefficient reprice their margin and
liquidation price live.

## What it shows (the thesis, clickable)

- **Gap coefficient** front and centre — turns amber and reads "pricing the dark" when the
  weekend is being priced in.
- **Live margin breakdown** on every order: notional × base × **gap coefficient** × **your tier**.
- **Live liquidation price** that crawls toward entry as the coefficient rises.
- Real order book (aggregated depth), price line, positions with unrealized PnL + margin ratio.

## Run it against your venue

1. Start the venue in **demo mode** (browsers that connect get $100k testnet USDC + tier B):
   ```
   cd engine && caffeinate -is npm run venue -- --offline --demo
   ```
2. Open `apps/web/index.html` in a browser (double-click it, or `open apps/web/index.html`).
3. Click **Start trading — testnet**. It connects to `ws://localhost:8787`, funds a burner
   wallet, and you're trading.

The engine endpoint is configurable: the box on the start screen, or `?engine=ws://host:port`
in the URL.

## Put it in front of an investor (remote)

The page is static — host it anywhere. The engine must be reachable from the investor's
browser. Two paths:

**Fast (tunnel from your Mac):** with the venue running, expose it publicly:
```
brew install cloudflared        # once
cloudflared tunnel --url http://localhost:8787
```
This prints a public `https://<random>.trycloudflare.com` URL. The investor opens the page
with `?engine=wss://<random>.trycloudflare.com` and trades against your Mac. Zero cost,
live in a minute. (Also pass `--origins=https://your-page-host` to the venue so the browser
is allowed.)

**Robust (host the engine):** deploy the engine to a small VPS (~$5/mo) so it doesn't depend
on your laptop being awake. Same UI, stable URL. This is the M4 hosting step.

**The page itself:** drag `index.html` onto [vercel.com](https://vercel.com) or
[netlify.com](https://netlify.com) drop-zone for an instant public URL, or serve it beside
the tunnel.

## Notes

- Testnet only. The burner wallet is generated in-browser; the engine auto-funds it in demo
  mode. No real funds, no real keys.
- Auth is address-as-token (documented testnet stub); production swaps in wallet-signature
  auth without changing the UI.
- Fonts load from Google Fonts (needs internet); everything else is inline and offline-safe.
