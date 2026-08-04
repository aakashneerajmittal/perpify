"""
features.py — the canonical Trader-DNA feature extraction.

This module is the SINGLE SOURCE OF TRUTH for how a trader's reconstructed
round-trips become the model's input vector. It is deliberately written in
plain, portable arithmetic so it can be re-implemented byte-for-byte in the
browser (trader-dna/app) — training (Python) and inference (JS) MUST compute
identical features or the exported model is meaningless.

A RoundTrip (the unit reconstructed from raw fills by the FIFO position-walk,
`buildClosedPositions`, shared with the venue's PnL history) is a dict:

  {
    "t":        float,   # entry time, days since first trade
    "symbol":   str,
    "side":     +1|-1,   # +1 long, -1 short
    "notional": float,   # |qty*entry|, position size in account ccy
    "equity":   float,   # account equity at entry (peak-deployed proxy on CSV)
    "pnl":      float,    # realized PnL in account ccy (net of fees)
    "hold":     float,   # holding period, days
    "vol_reg":  int,      # 0 calm, 1 normal, 2 elevated, 3 crisis (venue vocab)
    "grey":     bool,     # chop/untradeable tape at entry ("grey zone")
    "mkt_ret":  float,    # market return over the hold window (beta reference)
  }

FEATURES is the ordered feature list. Keep this order stable across versions;
the exported model.json pins it and the JS reads it back.
"""

import math

FEATURES = [
    "sizing_median",     # median position size as fraction of equity
    "sizing_cov",        # coefficient of variation of size/equity (consistency)
    "concentration",     # largest single position as fraction of equity
    "win_rate",          # fraction of round-trips in profit
    "payoff",            # avg win / avg loss (abs), capped
    "profit_factor",     # gross profit / gross loss, capped
    "expectancy",        # mean(pnl/equity) — avg per-trade return
    "max_drawdown",      # deepest equity-curve drawdown (fraction)
    "downside_dev",      # std of negative per-trade returns
    "tail_loss",         # 95th-pctile single-trade loss (fraction of equity)
    "revenge_sizing",    # avg size-up after a loss vs after a win
    "post_loss_freq",    # share of trades taken <1d after a loss (tilt cadence)
    "disposition",       # median loser hold / median winner hold (holds losers)
    "hold_cov",          # coefficient of variation of hold time
    "overtrade",         # trades per active day
    "turnover",          # sum(notional)/median equity (gross churn)
    "tenure",            # log1p(span in days)
    "blowup_rate",       # share of trades losing >20% of equity
    "grey_restraint",    # steps back in the grey/chop tape (rare discipline)
    "crisis_addrisk",    # sizes UP into crisis vs calm (reckless)
    "regime_coverage",   # distinct vol-regimes seen / 4 (confidence + factor)
    "beta_share",        # variance share of returns explained by market beta
]
N_FEATURES = len(FEATURES)


def _median(xs):
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return 0.0
    if n % 2 == 1:
        return s[n // 2]
    return 0.5 * (s[n // 2 - 1] + s[n // 2])


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs):
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _pctile(xs, p):
    if not xs:
        return 0.0
    s = sorted(xs)
    k = (len(s) - 1) * p
    lo = int(math.floor(k))
    hi = int(math.ceil(k))
    if lo == hi:
        return s[lo]
    return s[lo] * (hi - k) + s[hi] * (k - lo)


def extract_features(rts):
    """rts: list[RoundTrip] (chronological). Returns dict feature->float."""
    f = {k: 0.0 for k in FEATURES}
    n = len(rts)
    if n == 0:
        return f

    eq = [max(1e-9, r["equity"]) for r in rts]
    size_frac = [r["notional"] / e for r, e in zip(rts, eq)]
    ret = [r["pnl"] / e for r, e in zip(rts, eq)]  # per-trade return on equity
    holds = [max(1e-6, r["hold"]) for r in rts]

    wins = [x for x in ret if x > 0]
    losses = [x for x in ret if x < 0]

    f["sizing_median"] = _median(size_frac)
    m_sz = _mean(size_frac)
    f["sizing_cov"] = (_std(size_frac) / m_sz) if m_sz > 1e-9 else 0.0
    f["concentration"] = max(size_frac)
    f["win_rate"] = len(wins) / n

    avg_win = _mean(wins) if wins else 0.0
    avg_loss = abs(_mean(losses)) if losses else 0.0
    f["payoff"] = min(10.0, avg_win / avg_loss) if avg_loss > 1e-9 else (3.0 if wins else 0.0)

    gp = sum(wins)
    gl = abs(sum(losses))
    f["profit_factor"] = min(10.0, gp / gl) if gl > 1e-9 else (3.0 if gp > 0 else 0.0)

    f["expectancy"] = _mean(ret)

    # equity curve drawdown from compounded per-trade returns
    curve = []
    lvl = 1.0
    for x in ret:
        lvl *= (1.0 + x)
        curve.append(lvl)
    peak = -1e18
    mdd = 0.0
    for v in curve:
        peak = max(peak, v)
        if peak > 0:
            mdd = max(mdd, (peak - v) / peak)
    f["max_drawdown"] = mdd

    f["downside_dev"] = _std(losses) if len(losses) >= 2 else (abs(losses[0]) if losses else 0.0)
    f["tail_loss"] = abs(min(0.0, _pctile(ret, 0.05)))

    # revenge sizing: mean size after a loss vs after a win
    after_loss, after_win = [], []
    for i in range(1, n):
        if ret[i - 1] < 0:
            after_loss.append(size_frac[i])
        elif ret[i - 1] > 0:
            after_win.append(size_frac[i])
    al, aw = _mean(after_loss), _mean(after_win)
    f["revenge_sizing"] = (al / aw - 1.0) if aw > 1e-9 else 0.0

    # post-loss cadence: fraction of trades entered within 1 day of a prior loss
    quick_after_loss = 0
    for i in range(1, n):
        if ret[i - 1] < 0 and (rts[i]["t"] - rts[i - 1]["t"]) < 1.0:
            quick_after_loss += 1
    f["post_loss_freq"] = quick_after_loss / n

    loser_holds = [h for h, x in zip(holds, ret) if x < 0]
    winner_holds = [h for h, x in zip(holds, ret) if x > 0]
    mh_w = _median(winner_holds) if winner_holds else 0.0
    f["disposition"] = min(6.0, _median(loser_holds) / mh_w) if (loser_holds and mh_w > 1e-9) else 1.0

    m_h = _mean(holds)
    f["hold_cov"] = (_std(holds) / m_h) if m_h > 1e-9 else 0.0

    span = max(1e-6, rts[-1]["t"] - rts[0]["t"]) + _mean(holds)
    active_days = max(1.0, span)
    f["overtrade"] = n / active_days
    f["turnover"] = sum(r["notional"] for r in rts) / _median(eq)
    f["tenure"] = math.log1p(span)
    f["blowup_rate"] = sum(1 for x in ret if x < -0.20) / n

    # grey-zone restraint: do they DEPLOY LESS in the chop/untradeable tape?
    grey_sizes = [size_frac[i] for i in range(n) if rts[i]["grey"]]
    clear_sizes = [size_frac[i] for i in range(n) if not rts[i]["grey"]]
    if grey_sizes and clear_sizes:
        g, c = _mean(grey_sizes), _mean(clear_sizes)
        # >0 => smaller in grey (good restraint); <0 => sizes up in chop (bad)
        f["grey_restraint"] = max(-1.0, min(1.0, 1.0 - g / c)) if c > 1e-9 else 0.0
    else:
        f["grey_restraint"] = 0.0

    calm_sizes = [size_frac[i] for i in range(n) if rts[i]["vol_reg"] <= 1]
    crisis_sizes = [size_frac[i] for i in range(n) if rts[i]["vol_reg"] == 3]
    if crisis_sizes and calm_sizes:
        f["crisis_addrisk"] = max(-1.0, min(3.0, _mean(crisis_sizes) / _mean(calm_sizes) - 1.0))
    else:
        f["crisis_addrisk"] = 0.0

    f["regime_coverage"] = len(set(r["vol_reg"] for r in rts)) / 4.0

    # beta share: variance of (beta*mkt) over variance of returns
    mkt = [r["mkt_ret"] for r in rts]
    vr = _std(ret) ** 2
    vm = _std(mkt) ** 2
    if vr > 1e-12 and vm > 1e-12:
        mr, mm = _mean(ret), _mean(mkt)
        cov = sum((ret[i] - mr) * (mkt[i] - mm) for i in range(n)) / (n - 1) if n > 1 else 0.0
        beta = cov / vm
        f["beta_share"] = max(0.0, min(1.0, (beta ** 2 * vm) / vr))
    else:
        f["beta_share"] = 0.0

    return f


def vector(feat):
    return [feat[k] for k in FEATURES]
