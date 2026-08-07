# @perpify/connect — read-only Trader-DNA connect (the only server surface)

Turns a trader's real, read-only exchange history into the round-trips the Trader-DNA model scores,
and hands the venue a **verified provisional tier**. Crypto side (Binance / Bybit / OKX) is built
end-to-end; the equities aggregator is deferred.

## Pipeline
`fetch (read-only) → normalize → reconstruct (FIFO round-trips) → score (Trader-DNA model) → verified tier`

- `sign.ts` / `client.ts` — per-exchange HMAC signing + paginated read-only fetch. The API **secret
  is only ever fed into an HMAC** — never a URL, header, or log.
- `reconstruct.ts` — FIFO signed-qty walk → round-trips (hold, R-multiple, MAE), same vocabulary the
  engine captures on-venue.
- `features.ts` / `score.ts` — TS port of `trader-dna/train/features.py` + the GBT model
  (`model/dna-v0.1.json`), parity-proven vs `trader-dna/train/test_cases.json`.
- `server.ts` — `runConnect()` + HTTP: `GET /health`, `POST /connect/history`.

## Security posture (decisions, Aug 7)
- **Read-only, no withdrawal.** Users mint keys with trade/withdraw disabled.
- **Ephemeral keys.** A key signs the one fetch-and-score request, then is discarded — nothing
  persisted. (Always-fresh re-scoring, needing stored keys, is a later opt-in behind KMS encryption.)
- **Mainnet attestation.** Set `CONNECT_ATTEST_KEY`; the service signs each verified tier reading and
  the engine verifies with `CONNECT_ATTEST_PUBKEY`. Testnet trusts it as sent.

## Run / deploy
```
npm install
npm test          # 39 tests (reconstruction, normalizers, signing, scoring parity, server)
npm start         # boots on :8787  (PORT to override)
```
Deploy on Render from `render.yaml` (health check `GET /health`). Set secrets in the dashboard.

## API
`POST /connect/history` — body:
```json
{ "exchange": "binance|bybit|okx", "apiKey": "...", "apiSecret": "...", "passphrase": "okx only",
  "symbols": ["BTCUSDT"], "wallet": "0x… (optional → returns a verified tierReading)" }
```
Returns `{ ok, summary, roundTrips, scored, tierReading }`. `tierReading` is shaped for the engine's
`connect_tier` / `TierUpdate` path.
