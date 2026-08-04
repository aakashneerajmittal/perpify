"""Emit parity test cases: round-trips + Python-computed features/raw/score.
The browser must reproduce these to <1e-6 (features) / <0.1 (score)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from features import extract_features, vector, FEATURES
from simulate import simulate_market, simulate_trader, ARCHETYPE_NAMES

HERE = os.path.dirname(__file__)
MODEL = json.load(open(os.path.join(HERE, "..", "app", "model.json")))
EXP = MODEL["model"]


def manual_predict(x):
    raw = EXP["base"]; lr = EXP["learningRate"]
    for tr in EXP["trees"]:
        node = 0
        while tr["left"][node] != -1:
            f = tr["feat"][node]
            node = tr["left"][node] if x[f] <= tr["thr"][node] else tr["right"][node]
        raw += lr * tr["val"][node]
    return raw


def score_of(raw):
    xs = MODEL["calibration"]["raw"]; ys = MODEL["calibration"]["pct"]
    return float(max(0.0, min(100.0, 100.0 * np.interp(raw, xs, ys))))


def main():
    rng = np.random.default_rng(4242)
    market = simulate_market(rng, 1300)
    cases = []
    for name in ARCHETYPE_NAMES:
        for _ in range(3):
            rts, _ = simulate_trader(rng, market, name)
            if len(rts) < 14:
                continue
            k = int(len(rts) * 0.55)
            feat_rts = rts[:k]
            if len(feat_rts) < 6:
                continue
            F = extract_features(feat_rts)
            x = vector(F)
            raw = manual_predict(x)
            cases.append({
                "archetype": name,
                "roundtrips": [{kk: r[kk] for kk in ("t", "side", "notional", "equity", "pnl", "hold", "vol_reg", "grey", "mkt_ret")} for r in feat_rts],
                "features": {k: F[k] for k in FEATURES},
                "vector": x,
                "raw": raw,
                "score": score_of(raw),
            })
            if len(cases) >= 20:
                break
        if len(cases) >= 20:
            break
    out = os.path.join(HERE, "test_cases.json")
    json.dump(cases, open(out, "w"))
    print(f"wrote {len(cases)} cases -> {out}")


if __name__ == "__main__":
    main()
