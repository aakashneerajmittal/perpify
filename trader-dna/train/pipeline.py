"""
pipeline.py — train the Trader-DNA model and export it for client-side inference.

Flow:
  1. simulate a synthetic across-regime corpus of trader histories (simulate.py)
  2. for each trader, split round-trips in time: features from the earlier
     window, a self-supervised REGIME-ADJUSTED forward-risk label from the
     held-out later window (market beta regressed out -> idiosyncratic skill)
  3. train a gradient-boosted regressor (behavior -> forward quality)
  4. calibrate raw output -> 0..100 score; derive A..E tiers (venue TIER_MULT)
  5. compute archetype centroids + per-feature percentile knots + radar axes
  6. export everything to app/model.json and VERIFY a byte-identical
     re-implementation of inference (what the browser will run) matches sklearn.

Run:  python3 trader-dna/train/pipeline.py
"""

import json
import math
import os
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

sys.path.insert(0, os.path.dirname(__file__))
from features import FEATURES, N_FEATURES, extract_features, vector  # noqa: E402
from simulate import (ARCHETYPE_NAMES, simulate_market, simulate_trader,  # noqa: E402
                      DAILY_VOL_TO_ANN)

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "app", "model.json")
MODEL_VERSION = "dna-v0.1"
SEED = 20260804
N_TRADERS_PER_ARCH = 700          # ~7k traders total
FEATURE_SPLIT = 0.55              # earlier 55% -> features, later 45% -> label

# radar axes: (feature, sign) — sign +1 higher-is-better, -1 lower-is-better
RADAR_AXES = {
    "Discipline":   [("revenge_sizing", -1), ("blowup_rate", -1), ("post_loss_freq", -1), ("disposition", -1)],
    "Risk Control": [("max_drawdown", -1), ("tail_loss", -1), ("concentration", -1), ("downside_dev", -1)],
    "Regime IQ":    [("grey_restraint", 1), ("crisis_addrisk", -1), ("regime_coverage", 1), ("beta_share", -1)],
    "Consistency":  [("sizing_cov", -1), ("hold_cov", -1), ("overtrade", -1), ("turnover", -1)],
    "Edge":         [("expectancy", 1), ("profit_factor", 1), ("win_rate", 1), ("payoff", 1)],
}


def regime_adjusted_label(rts):
    """Self-supervised forward quality of the LABEL window round-trips.

    idio_sharpe - 2*idio_maxdd - 3*blowup_rate, with market beta regressed out
    so we score idiosyncratic behavior, not the era. Higher = better."""
    n = len(rts)
    if n < 4:
        return None
    eq = [max(1e-9, r["equity"]) for r in rts]
    r = np.array([rts[i]["pnl"] / eq[i] for i in range(n)])
    m = np.array([rts[i]["mkt_ret"] for i in range(n)])

    vm = np.var(m)
    beta = (np.cov(r, m)[0, 1] / vm) if vm > 1e-12 else 0.0
    idio = r - beta * m

    span_days = max(5.0, rts[-1]["t"] - rts[0]["t"])
    trades_per_year = n / (span_days / 365.0)
    sd = np.std(idio)
    sharpe = (np.mean(idio) / sd * math.sqrt(min(trades_per_year, 260))) if sd > 1e-9 else 0.0
    sharpe = float(np.clip(sharpe, -6, 6))

    lvl, peak, mdd = 1.0, 1.0, 0.0
    for x in idio:
        lvl *= (1.0 + x)
        peak = max(peak, lvl)
        if peak > 0:
            mdd = max(mdd, (peak - lvl) / peak)

    blowup = float(np.mean(r < -0.20))
    label = sharpe - 2.0 * mdd - 3.0 * blowup
    return float(np.clip(label, -8, 6))


def build_corpus():
    rng = np.random.default_rng(SEED)
    market = simulate_market(rng, n_days=1300)
    X, y, skills, archs = [], [], [], []
    for ai, name in enumerate(ARCHETYPE_NAMES):
        for _ in range(N_TRADERS_PER_ARCH):
            rts, meta = simulate_trader(rng, market, name)
            if len(rts) < 14:
                continue
            k = int(len(rts) * FEATURE_SPLIT)
            feat_rts, label_rts = rts[:k], rts[k:]
            if len(feat_rts) < 6 or len(label_rts) < 5:
                continue
            lab = regime_adjusted_label(label_rts)
            if lab is None:
                continue
            X.append(vector(extract_features(feat_rts)))
            y.append(lab)
            skills.append(meta["skill"])
            archs.append(ai)
    return np.array(X, float), np.array(y, float), np.array(skills, float), np.array(archs, int), market


def export_trees(model):
    trees = []
    for est in model.estimators_[:, 0]:
        t = est.tree_
        val = t.value.ravel()  # (n_nodes,) raw leaf/node values
        trees.append({
            "feat": t.feature.astype(int).tolist(),
            "thr": [round(float(x), 7) for x in t.threshold],
            "left": t.children_left.astype(int).tolist(),
            "right": t.children_right.astype(int).tolist(),
            "val": [round(float(x), 8) for x in val],
        })
    return trees


def manual_predict_one(export, x):
    """EXACT re-implementation of what the browser will run. Must match sklearn."""
    raw = export["base"]
    lr = export["learningRate"]
    for tr in export["trees"]:
        node = 0
        while tr["left"][node] != -1:
            f = tr["feat"][node]
            node = tr["left"][node] if x[f] <= tr["thr"][node] else tr["right"][node]
        raw += lr * tr["val"][node]
    return raw


def calibration_knots(raw_vals, k=200):
    s = np.sort(raw_vals)
    qs = np.linspace(0, 1, k)
    knots_raw = np.quantile(s, qs)
    # dedupe monotonic
    xs, ys = [], []
    for i in range(len(knots_raw)):
        if not xs or knots_raw[i] > xs[-1] + 1e-9:
            xs.append(float(knots_raw[i]))
            ys.append(float(qs[i]))
    return {"raw": [round(v, 6) for v in xs], "pct": [round(v, 6) for v in ys]}


def feature_knots(X, k=128):
    knots = {}
    for j, name in enumerate(FEATURES):
        col = np.sort(X[:, j])
        idx = np.linspace(0, len(col) - 1, min(k, len(col))).astype(int)
        knots[name] = [round(float(col[i]), 6) for i in idx]
    return knots


def main():
    print("simulating corpus...")
    X, y, skills, archs, market = build_corpus()
    print(f"  corpus: {len(X)} traders x {N_FEATURES} features")
    print(f"  label: mean={y.mean():.3f} std={y.std():.3f} min={y.min():.2f} max={y.max():.2f}")

    mu = X.mean(0)
    sd = X.std(0) + 1e-9

    # honest out-of-sample check on a held-out 20% before fitting the shipped model
    rng2 = np.random.default_rng(SEED + 1)
    perm = rng2.permutation(len(X))
    cut = int(len(X) * 0.8)
    tr_idx, te_idx = perm[:cut], perm[cut:]

    def _params():
        return GradientBoostingRegressor(
            n_estimators=300, learning_rate=0.045, max_depth=3,
            subsample=0.7, min_samples_leaf=40, random_state=SEED)

    print("training gradient-boosted model...")
    holdout = _params().fit(X[tr_idx], y[tr_idx])
    p_te = holdout.predict(X[te_idx])
    r2_te = 1 - float(np.sum((y[te_idx] - p_te) ** 2)) / float(np.sum((y[te_idx] - y[te_idx].mean()) ** 2))
    corr_skill_te = float(np.corrcoef(p_te, skills[te_idx])[0, 1])
    print(f"  HELD-OUT (20%): R^2={r2_te:.3f}   corr(pred, latent skill)={corr_skill_te:.3f}")

    # ship a model fit on the full corpus
    model = _params().fit(X, y)
    pred = model.predict(X)
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot
    corr_skill = float(np.corrcoef(pred, skills)[0, 1])
    print(f"  full-fit R^2={r2:.3f}   corr(pred, latent skill)={corr_skill:.3f}")

    export = {
        "base": float(model.init_.constant_.ravel()[0]),
        "learningRate": float(model.learning_rate),
        "trees": export_trees(model),
    }

    # VERIFY: browser-equivalent inference == sklearn (correctness gate)
    man = np.array([manual_predict_one(export, X[i]) for i in range(0, len(X), 7)])
    ref = pred[0:len(X):7]
    max_err = float(np.max(np.abs(man - ref)))
    print(f"  export verify: max|manual - sklearn| = {max_err:.2e}")
    assert max_err < 1e-6, "exported tree inference does not match sklearn!"

    calib = calibration_knots(pred, 200)

    # archetype centroids in standardized feature space
    centroids = []
    from simulate import ARCHETYPES
    for ai, name in enumerate(ARCHETYPE_NAMES):
        mask = archs == ai
        c = ((X[mask].mean(0) - mu) / sd).tolist()
        # mean score of this archetype (for display ordering / sanity)
        msc = float(np.interp(model.predict(X[mask]).mean(),
                              calib["raw"], calib["pct"]) * 100)
        centroids.append({
            "name": name,
            "desc": ARCHETYPES[name]["desc"],
            "centroid": [round(v, 4) for v in c],
            "meanScore": round(msc, 1),
        })

    # tier cutoffs on the 0..100 score, aligned to engine TIER_MULT
    tiers = [
        {"tier": "A", "min": 80, "mult": 0.75},
        {"tier": "B", "min": 62, "mult": 0.90},
        {"tier": "C", "min": 42, "mult": 1.00},
        {"tier": "D", "min": 22, "mult": 1.20},
        {"tier": "E", "min": 0, "mult": 1.45},
    ]

    out = {
        "modelVersion": MODEL_VERSION,
        "trainedOn": "synthetic across-regime corpus (gap-v0.1 regime vocabulary)",
        "nTrainingTraders": int(len(X)),
        "features": FEATURES,
        "featureMean": [round(float(v), 6) for v in mu],
        "featureStd": [round(float(v), 6) for v in sd],
        "model": export,
        "calibration": calib,
        "tiers": tiers,
        "archetypes": centroids,
        "featureKnots": feature_knots(X),
        "radarAxes": RADAR_AXES,
        "diagnostics": {
            "r2": round(r2, 4),
            "r2HeldOut": round(r2_te, 4),
            "corrLatentSkill": round(corr_skill, 4),
            "corrLatentSkillHeldOut": round(corr_skill_te, 4),
            "labelMean": round(float(y.mean()), 4),
            "labelStd": round(float(y.std()), 4),
        },
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    kb = os.path.getsize(OUT) / 1024
    print(f"wrote {OUT}  ({kb:.0f} KB)")

    # archetype score ordering sanity
    print("\narchetype mean scores (should rank disciplined high, gambler low):")
    for c in sorted(centroids, key=lambda c: -c["meanScore"]):
        print(f"  {c['meanScore']:5.1f}  {c['name']}")


if __name__ == "__main__":
    main()
