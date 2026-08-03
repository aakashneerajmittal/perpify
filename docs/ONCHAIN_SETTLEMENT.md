# Turning on-chain settlement live (Base Sepolia)

**Status:** the contracts are deployed and tested on Base Sepolia, and the engine's
settlement pipeline (deposit scanning, epoch state-root posting, risk-reading posting) is
written, tested, and **flip-ready**. The live demo engine runs **off-chain on purpose** — it's
faster and can't be knocked over by an RPC hiccup mid-investor-call. Everything below is the
one-time switch to make the deployed engine settle on-chain live. It needs a secret only you
should hold, so this is a hand-off, not something the build does automatically.

## What you'll need

A **dedicated testnet wallet** whose private key you're willing to put in the host environment,
funded with a little **Base Sepolia ETH** (for gas — free from any Base Sepolia faucet). This
must **not** be a wallet that holds any real funds. There is no real money anywhere in this
system; the key just pays testnet gas to post state roots.

## The switch (Render dashboard — no code, no rebuild)

1. Open Render → the **perpify-engine** service → **Environment**.
2. Add three variables:
   - `PERPIFY_ONCHAIN` = `1`  — overrides the image's built-in off-chain default.
   - `PRIVATE_KEY` = *your dedicated testnet operator key* (mark it secret).
   - `BASE_SEPOLIA_RPC_URL` = *(optional)* your own RPC URL; leave unset to use the public
     `https://sepolia.base.org`.
3. Save. Render redeploys automatically (~2–3 min).

## Confirming it's live

In the service **Logs**, a successful switch shows at boot:

```
[boot] chain: Base Sepolia settlement ON (operator key loaded)
```

From then on you'll see deposit-scan activity and, at each daily epoch close, a line like:

```
[epoch] 2 settled 0x<txhash>
```

Paste that tx hash into https://sepolia.basescan.org to see the state root posted on-chain — the
same byte-identical root the engine computed locally. That is the "anyone can verify the venue"
story, live.

## Safety / rollback

- **Crash-safe by design.** If `PRIVATE_KEY` is missing or the RPC is unreachable, the engine
  logs `chain OFF — … running off-chain` and keeps trading normally. It never hard-fails the
  venue because of a chain problem.
- **Instant rollback.** Delete `PERPIFY_ONCHAIN` (or set it to `0`) and save — the next deploy is
  back to the safe off-chain demo. Nothing else changes.
- **Nothing secret is in the repo or the Docker image.** The key lives only in the Render
  environment you set. `contracts/.env` is git-ignored, and the engine image only copies
  `engine/` and `risk/`, never `contracts/`.

## Why it's off by default

For a fundraise demo, reliability beats on-chain-ness in the moment: an off-chain engine can't be
stalled by a slow testnet RPC while someone is watching. The on-chain path is fully built so you
can turn it on for a specific "watch it settle on Basescan" moment, then turn it back off.
