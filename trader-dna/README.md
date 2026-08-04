# Trader DNA — `score.perpify.trade`

A behavioral mirror for traders, and the venue's real behavioral-underwriting
engine getting built. Connect an exchange or drop a CSV (crypto or stocks); an
ML model scores your behavior the way Perpify prices risk — archetype, tier,
what you did **for the market you were handed**, and the dollar cost of your
worst habits.

## Why it's real (not a rules engine)

The score is a **gradient-boosted model** trained on a synthetic across-regime
corpus, with a **self-supervised, regime-adjusted forward-risk label** (market
beta regressed out → idiosyncratic skill). Explanations are the model's own
**Saabas path attributions** (SHAP-style). Held-out R² = 0.77; the model
recovers latent skill it never saw (corr 0.63). See `train/`.

## Layout

```
trader-dna/
  train/
    features.py        canonical feature extraction (SOURCE OF TRUTH)
    simulate.py        synthetic across-regime corpus + 10 named archetypes
    pipeline.py        train GBT + calibrate + export -> app/model.json
    build_dist.py      inline model.json -> dist/index.html (single file)
    export_testcases.py / test_parity.mjs / test_csv.mjs   verification
  app/
    index.html         the app (fetches ./model.json)
    model.json         exported model (300 trees, calibration, archetypes, knots)
  dist/
    index.html         self-contained single file (model inlined) — deploy this
```

## Rebuild / retrain

```
python3 train/pipeline.py          # retrain + export app/model.json
python3 train/build_dist.py        # produce dist/index.html
node    train/export_testcases.py  # regenerate parity fixtures
node    train/test_parity.mjs      # JS↔Python feature/score parity (must be 0)
node    train/test_csv.mjs         # CSV adapter + generic-mapper funnel
```

## Deploy to `score.perpify.trade`

The app is fully static and client-side (uploaded CSVs never leave the browser).
Two options:

1. **Single file (simplest):** deploy `trader-dna/dist/index.html` — drag it into
   a new Netlify site (no build step), then point the `score` CNAME at it.
2. **Split (model cached separately):** new Netlify site, **publish directory**
   `trader-dna/app`, **no build command**; it serves `index.html` + `model.json`.

Then in DNS add `score` → the new Netlify site (same flow as `demo`).

The live **read-only API-connect** flow (the verified-tier path) is the only
server surface and is scaffolded in the UI; it ships in v1.
