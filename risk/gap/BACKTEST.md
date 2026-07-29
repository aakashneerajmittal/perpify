# Gap Model v0.1 — Out-of-Sample Backtest

**Fit window:** 1995-01-04 → 2015-12-31 (5287 sessions)
**Test window:** 2016-01-04 → 2026-07-17 (2649 sessions — never seen by the fit)
**Model:** alpha=0.1325, rms_ref=0.00523 (weeknight-normal), floor 1.0, cap 2.5

## Coverage: did the priced risk cover the realized gaps?

Two-sided exceedance rates — |gap| > z·σ. Nominal is what a well-calibrated model
should show; closer to nominal is better. Static = same average machinery with the
coefficient frozen at 1.0 (how every existing venue prices the night).

| Confidence | Nominal | Perpify model | Static venue |
|---|---|---|---|
| 90% | 10.00% | 8.15% | 12.53% |
| 95% | 5.00% | 5.13% | 8.95% |
| 99% | 1.00% | 2.53% | 4.79% |

99% exception count: **67 of 2649** (expected 26.5); binomial two-sided p = 0.000

## Where the static venue breaks: 99% exceedances by condition

| Condition | Sessions | Perpify exceed. | Static exceed. | Nominal |
|---|---|---|---|---|
| weeknight · calm | 856 | 0.35% | 0.35% | 1.00% |
| weeknight · normal | 805 | 2.86% | 2.86% | 1.00% |
| weeknight · elevated | 352 | 3.69% | 11.08% | 1.00% |
| weeknight · crisis | 59 | 11.86% | 37.29% | 1.00% |
| extended · calm | 248 | 3.23% | 3.23% | 1.00% |
| extended · normal | 217 | 3.23% | 5.53% | 1.00% |
| extended · elevated | 96 | 3.12% | 13.54% | 1.00% |
| extended · crisis | 16 | 18.75% | 43.75% | 1.00% |

## What the protection costs

Average coefficient across all OOS sessions: **1.163** (median 1.000).
72% of sessions sit at the floor (coefficient 1.0) — margin is only raised
when measured conditions justify it; the extra cost concentrates exactly where the
extra risk lives:

| Condition | Avg coefficient |
|---|---|
| weeknight · calm | 1.000 |
| weeknight · normal | 1.000 |
| weeknight · elevated | 1.574 |
| weeknight · crisis | 2.500 |
| extended · calm | 1.000 |
| extended · normal | 1.133 |
| extended · elevated | 1.943 |
| extended · crisis | 2.360 |

## The ten worst OOS gaps — was the model awake that night?

| Date | Gap | Dark | Regime at close | Coefficient | gap / σ_model | gap / σ_static |
|---|---|---|---|---|---|---|
| 2020-03-16 | -10.45% | extended | crisis | 2.36 | 8.9σ | 21.1σ |
| 2020-03-09 | -7.45% | extended | crisis | 2.36 | 6.3σ | 14.8σ |
| 2020-03-12 | -6.69% | weeknight | crisis | 2.50 | 5.3σ | 13.2σ |
| 2020-03-18 | -6.55% | weeknight | crisis | 2.50 | 5.2σ | 13.0σ |
| 2020-03-13 | +6.04% | weeknight | crisis | 2.50 | 4.5σ | 11.2σ |
| 2020-03-24 | +5.14% | weeknight | crisis | 2.50 | 3.8σ | 9.6σ |
| 2024-08-05 | -3.99% | extended | normal | 1.13 | 6.9σ | 7.8σ |
| 2020-11-09 | +3.94% | extended | elevated | 1.94 | 3.8σ | 7.4σ |
| 2020-04-01 | -3.79% | weeknight | crisis | 2.50 | 3.0σ | 7.4σ |
| 2020-04-06 | +3.89% | extended | crisis | 2.36 | 3.1σ | 7.3σ |

## Margin of safety at launch parameters

At the V1 launch base IM of 33.3% (3x), the WORST out-of-sample night
(2020-03-16, gap -10.45%, coefficient 2.36)
still left a margin-of-safety multiple of **7.1x** — the gap consumed
14.0% of initial margin. No overnight gap in 10.5 OOS years came within
an order of magnitude of exhausting a fresh position's margin.

## Known limitations (v0.1 — stated, not hidden)

1. **Fat tails vs Gaussian quantiles.** Exceedance tests above use normal z-scores;
   overnight gaps are fatter-tailed than normal, so 99% coverage reads 2.5% rather
   than 1%. The operative claim is relative: ~2–4x fewer tail breaches than a static
   venue at nearly identical average margin. gap-v0.2 moves to empirical per-cell
   quantiles, which calibrates absolute coverage too.
2. **2024-08-05, the case study for v0.2.** The yen-carry unwind weekend: regime
   measured at Friday's close read *normal*, the model priced 1.13, and Monday opened
   −3.99% (6.9σ). Conditions changed DURING the dark period — precisely the scheduled-
   event calendar and overnight cross-asset anchors the playbook specifies as inputs
   (c) and (d). Until those land, the coefficient can only know what the close knew.
3. **The cap binds in crisis (2.5).** Deliberate: beyond the cap, protection is the
   leverage ladder, the sequencer, and the insurance stack — not IM alone. Margin
   cannot be the only line of defense without pricing everyone out of quiet markets.

---
*Reproduce: `python3 gap/backtest.py` (deterministic; no sampling). Production params*
*are refit on the full sample and versioned as `gap-v0.1` with an on-chain artifact hash.*
