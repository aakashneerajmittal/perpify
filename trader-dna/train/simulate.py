"""
simulate.py — the synthetic across-regime trader corpus.

Cold-start (Kill Two: "AI narrative outruns product truth") is answered by
pre-training on thousands of Monte-Carlo trader histories drawn from named
behavioral archetypes, each run across a simulated market that cycles through
the venue's four vol regimes (calm / normal / elevated / crisis) plus grey
(chop / untradeable) tape. Behavior is latent; PnL is *emergent* from behavior
x market — so the model learns which behaviors predict idiosyncratic blowups,
not which era someone happened to trade.

Everything is seeded and deterministic.
"""

import numpy as np

# venue regime vocabulary — annualized-vol bounds match risk/gap/params/gap-v0.1.json
REGIME_BOUNDS = [0.12, 0.20, 0.35]  # calm|normal , normal|elevated , elevated|crisis
DAILY_VOL_TO_ANN = np.sqrt(252.0)


def _vol_regime(ann_vol):
    if ann_vol < REGIME_BOUNDS[0]:
        return 0  # calm
    if ann_vol < REGIME_BOUNDS[1]:
        return 1  # normal
    if ann_vol < REGIME_BOUNDS[2]:
        return 2  # elevated
    return 3      # crisis


def simulate_market(rng, n_days=1300):
    """
    A multi-year daily tape with regime-switching stochastic volatility and
    trend/chop structure. Returns per-day arrays:
      ret[t]        market log-ish return
      ann_vol[t]    trailing annualized vol (for regime)
      vol_reg[t]    0..3 venue vol regime
      grey[t]       bool — chop/untradeable (low trend efficiency & not calm)
    """
    # stochastic vol: mean-reverting in log space with occasional crisis jumps
    log_v = np.log(0.008)  # ~12.7% annualized baseline daily vol
    kappa, theta, xi = 0.03, np.log(0.008), 0.15
    dv = np.zeros(n_days)
    vol = np.zeros(n_days)
    for t in range(n_days):
        shock = rng.normal(0, 1)
        # rare crisis regime: Poisson-ish vol explosions that decay
        if rng.random() < 0.006:
            log_v += rng.uniform(0.8, 1.6)
        log_v += kappa * (theta - log_v) + xi * shock
        log_v = min(log_v, np.log(0.06))  # cap daily vol ~95% ann
        vol[t] = np.exp(log_v)
        dv[t] = vol[t]

    # returns with mild, slowly-varying drift (bull/bear phases)
    drift = np.zeros(n_days)
    d = 0.0003
    for t in range(n_days):
        if rng.random() < 0.01:
            d = rng.uniform(-0.0006, 0.0009)
        drift[t] = d
    ret = drift + vol * rng.normal(0, 1, n_days)

    # trailing annualized vol (20d) -> regime
    ann_vol = np.zeros(n_days)
    vol_reg = np.zeros(n_days, dtype=int)
    for t in range(n_days):
        w = ret[max(0, t - 19):t + 1]
        ann_vol[t] = (np.std(w) if len(w) > 2 else vol[t]) * DAILY_VOL_TO_ANN
        vol_reg[t] = _vol_regime(ann_vol[t])

    # trend efficiency (Kaufman ratio) over 10d -> chop when low; grey = chop & not-calm
    grey = np.zeros(n_days, dtype=bool)
    price = np.cumsum(ret)
    for t in range(n_days):
        a = max(0, t - 9)
        seg = price[a:t + 1]
        if len(seg) < 3:
            continue
        net = abs(seg[-1] - seg[0])
        path = np.sum(np.abs(np.diff(seg))) + 1e-9
        er = net / path  # 1 = clean trend, ~0 = pure chop
        grey[t] = (er < 0.30) and (vol_reg[t] >= 1)

    return {"ret": ret, "ann_vol": ann_vol, "vol_reg": vol_reg, "grey": grey, "price": price}


# ---------------------------------------------------------------------------
# Named archetypes. Each is a latent behavior generator (params + a "skill"
# scalar used ONLY for validation, never as a training label). Real traders are
# sampled as archetype + noise, so the corpus is a continuum, not 10 points.
# ---------------------------------------------------------------------------
ARCHETYPES = {
    "Disciplined Macro": dict(
        base_size=0.06, size_vol=0.25, edge=0.055, stop=0.90, let_win=1.5,
        revenge=0.05, overtrade=0.35, crisis_blind=-0.4, grey_override=-0.5,
        disposition=0.85, long_bias=0.58, skill=0.92,
        desc="Sizes small and steady, cuts losers fast, presses winners, and steps aside when the tape turns grey."),
    "The Sniper": dict(
        base_size=0.09, size_vol=0.35, edge=0.075, stop=0.85, let_win=1.7,
        revenge=0.10, overtrade=0.18, crisis_blind=-0.2, grey_override=-0.35,
        disposition=0.8, long_bias=0.55, skill=0.9,
        desc="Few, high-conviction trades with a real edge and tight risk. Patience is the strategy."),
    "The Grinder": dict(
        base_size=0.04, size_vol=0.3, edge=0.02, stop=0.8, let_win=1.1,
        revenge=0.15, overtrade=1.3, crisis_blind=0.0, grey_override=0.1,
        disposition=1.0, long_bias=0.52, skill=0.6,
        desc="High-frequency, small-size scalper. Thin per-trade edge that lives or dies on discipline and fees."),
    "Trend Rider": dict(
        base_size=0.08, size_vol=0.4, edge=0.05, stop=0.7, let_win=2.2,
        revenge=0.2, overtrade=0.4, crisis_blind=0.1, grey_override=-0.2,
        disposition=0.7, long_bias=0.62, skill=0.72,
        desc="Rides winners hard in clean trends; strong in calm-trend regimes, exposed when trends break."),
    "Mean Reverter": dict(
        base_size=0.07, size_vol=0.45, edge=0.03, stop=0.5, let_win=0.9,
        revenge=0.35, overtrade=0.7, crisis_blind=0.3, grey_override=0.4,
        disposition=1.6, long_bias=0.5, skill=0.5,
        desc="Fades moves and adds against them. Prints steadily, then gives it back when a trend won't stop."),
    "The Revenge Trader": dict(
        base_size=0.09, size_vol=0.6, edge=0.0, stop=0.45, let_win=0.8,
        revenge=1.4, overtrade=1.0, crisis_blind=0.4, grey_override=0.5,
        disposition=2.2, long_bias=0.5, skill=0.28,
        desc="Fine until a loss — then sizes up to 'get it back'. Tilt cascades are the signature failure."),
    "The Overtrader": dict(
        base_size=0.05, size_vol=0.5, edge=-0.01, stop=0.6, let_win=0.9,
        revenge=0.5, overtrade=2.4, crisis_blind=0.2, grey_override=0.7,
        disposition=1.4, long_bias=0.5, skill=0.32,
        desc="Trades constantly, especially in chop. Negative expectancy bled dry by fees and grey-tape churn."),
    "The Gambler": dict(
        base_size=0.16, size_vol=0.8, edge=0.0, stop=0.3, let_win=1.0,
        revenge=0.9, overtrade=0.8, crisis_blind=0.9, grey_override=0.6,
        disposition=1.8, long_bias=0.55, skill=0.18,
        desc="Enormous, wildly varying bets with no stop. One good run, then a blowup that erases it all."),
    "The Martingale": dict(
        base_size=0.07, size_vol=0.5, edge=0.0, stop=0.15, let_win=0.7,
        revenge=1.9, overtrade=0.9, crisis_blind=0.6, grey_override=0.4,
        disposition=3.0, long_bias=0.5, skill=0.12,
        desc="Doubles down on losers and never stops out. Long strings of wins punctuated by account-ending losses."),
    "Passive Holder": dict(
        base_size=0.10, size_vol=0.3, edge=0.03, stop=0.6, let_win=2.5,
        revenge=0.1, overtrade=0.12, crisis_blind=0.2, grey_override=-0.1,
        disposition=1.3, long_bias=0.7, skill=0.55,
        desc="Rare, large, long-held directional bets. Mostly market beta — quiet until a regime change bites."),
}
ARCHETYPE_NAMES = list(ARCHETYPES.keys())


def _jitter(rng, v, frac=0.18, lo=None, hi=None):
    x = v * (1.0 + rng.normal(0, frac)) if v != 0 else rng.normal(0, frac)
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def simulate_trader(rng, market, arch_name, n_trades=None):
    """Simulate one trader's round-trip history over the market tape."""
    p = ARCHETYPES[arch_name]
    n_days = len(market["ret"])
    # per-trader realized param draw (continuum around the archetype)
    base_size = _jitter(rng, p["base_size"], 0.22, 0.005, 0.6)
    size_vol = _jitter(rng, p["size_vol"], 0.25, 0.05, 1.2)
    edge = p["edge"] + rng.normal(0, 0.02)
    stop = _jitter(rng, p["stop"], 0.15, 0.05, 0.98)
    let_win = _jitter(rng, p["let_win"], 0.15, 0.5, 3.0)
    revenge = _jitter(rng, p["revenge"], 0.3, 0.0, 3.0)
    overtrade = _jitter(rng, p["overtrade"], 0.3, 0.05, 4.0)
    crisis_blind = p["crisis_blind"] + rng.normal(0, 0.15)
    grey_override = p["grey_override"] + rng.normal(0, 0.15)
    disposition = _jitter(rng, p["disposition"], 0.2, 0.3, 4.0)
    long_bias = min(0.9, max(0.1, p["long_bias"] + rng.normal(0, 0.05)))

    if n_trades is None:
        n_trades = int(np.clip(rng.normal(90 * overtrade, 25), 12, 600))

    equity = float(np.exp(rng.uniform(np.log(2_000), np.log(400_000))))  # $2k..$400k
    start_eq = equity
    peak_eq = equity

    # entry days: cluster by overtrade; more active traders trade more days
    n_days_active = int(np.clip(n_trades / max(0.3, overtrade), 5, n_days - 5))
    start_day = rng.integers(0, max(1, n_days - n_days_active - 1))
    day_span = np.linspace(start_day, start_day + n_days_active, n_trades)
    day_span = np.clip(day_span + rng.normal(0, 3, n_trades), 0, n_days - 2).astype(int)
    day_span.sort()

    rts = []
    last_ret = 0.0
    for i in range(n_trades):
        d = int(day_span[i])
        vr = int(market["vol_reg"][d])
        grey = bool(market["grey"][d])
        daily_vol = max(1e-4, market["ann_vol"][d] / DAILY_VOL_TO_ANN)

        # --- SIZE (behavioral) ---
        size = base_size * np.exp(rng.normal(0, size_vol))
        if last_ret < 0:
            size *= (1.0 + revenge * min(2.0, abs(last_ret) / 0.02))  # revenge add
        # regime response: crisis_blind>0 sizes UP into vol (reckless); <0 trims
        size *= (1.0 + crisis_blind * (vr / 3.0))
        if grey:
            size *= (1.0 + grey_override)  # override<0 => steps back in chop
        size = float(np.clip(size, 0.002, 1.5))
        notional = size * equity

        # --- HOLD & OUTCOME (behavioral x market) ---
        side = 1 if rng.random() < long_bias else -1
        hold = float(np.clip(rng.lognormal(mean=np.log(1.0 + let_win), sigma=0.7), 0.02, 60))
        hd = max(1, int(round(hold)))
        seg = market["ret"][d:min(n_days, d + hd)]
        mkt_ret = float(np.sum(seg))
        # raw price move over hold for this trader's instrument (market + idio)
        idio = rng.normal(0, daily_vol * np.sqrt(hd) * 1.1)
        raw_move = mkt_ret + idio
        trade_ret = side * raw_move + edge * (1.0 if side == 1 else 1.0)  # edge as skill drift

        # stop discipline: with prob `stop`, cap the left tail at ~1.2 risk units
        risk_unit = daily_vol * np.sqrt(max(1, hd)) * 1.5
        if trade_ret < 0 and rng.random() < stop:
            trade_ret = max(trade_ret, -risk_unit * 1.2)
        # disposition: hold losers longer (already via let_win for winners); poor
        # disposition (>1) lets losers run a bit more -> fatter left tail
        if trade_ret < 0 and disposition > 1.2:
            trade_ret *= (1.0 + 0.15 * (disposition - 1.0))
        # no-stop archetypes can blow through in crisis
        if stop < 0.35 and vr == 3 and rng.random() < 0.25:
            trade_ret -= abs(rng.normal(0, 0.15))

        fee = 0.0006 * 2  # round-trip taker fee on notional fraction
        pnl = trade_ret * notional - fee * notional
        equity = max(50.0, equity + pnl)
        peak_eq = max(peak_eq, equity)
        last_ret = pnl / max(1e-9, notional)

        rts.append({
            "t": float(d - start_day),
            "symbol": "SYN",
            "side": side,
            "notional": notional,
            "equity": max(1.0, equity - pnl),  # equity at entry (pre-PnL)
            "pnl": pnl,
            "hold": hold,
            "vol_reg": vr,
            "grey": grey,
            "mkt_ret": mkt_ret,
        })

        # ruin: if equity craters, they stop (blowup)
        if equity < 0.15 * start_eq and rng.random() < 0.4:
            break

    return rts, dict(skill=p["skill"], archetype=arch_name)
