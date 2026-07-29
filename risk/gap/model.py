#!/usr/bin/env python3
"""Perpify gap model v0.1 — "prices the dark".

Turns 31 years of SPY close-to-open gaps into a margin coefficient published during
dark periods. Deliberately simple, fully reproducible, honest about its scope.

The model
---------
1. Every session's overnight gap g_i = ln(Open_i / Close_{i-1}) is conditioned on:
   - dark type: weeknight (~17.5h dark) vs extended (weekend/holiday, >=39h)
   - volatility regime at the prior close: EWMA (lambda=0.94) annualized vol bucketed
     into calm (<12%), normal (12-20%), elevated (20-35%), crisis (>35%)
2. Per (dark type x regime) cell we estimate RMS gap = sqrt(mean(g^2)) — RMS, not std,
   because margin must fund the full move including the mean, and tails matter.
   Sparse cells shrink toward their dark-type marginal: w = n / (n + K), K=60.
3. Duration scaling: sigma(d) ∝ d^alpha with alpha fitted from the weeknight vs
   extended RMS ratio. Empirically alpha << 0.5 — markets sleep; uncertainty does NOT
   accumulate like sqrt(time) while the underlying is closed. The same alpha drives the
   intra-period glide: remaining risk falls as the reopen approaches.
4. Coefficient: coeff(dark, regime, d_remaining) =
       clamp( (RMS_cell / RMS_ref) * (d_remaining / d_total)^alpha , 1.0 , 2.5 )
   where RMS_ref = weeknight-normal RMS (the risk level base IM already funds).
   During open hours the coefficient is 1.0 until 2h before a close, then ramps
   linearly to the upcoming dark period's initial value ("the Friday 4pm rule").

v0 scope honesty (documented, not hidden): no scheduled-event calendar, no overnight
cross-asset anchors yet (playbook v0.1+ items) — regime is measured at the close and
held through the dark period. The 4h cadence re-signs the glide path; it will start
moving intra-period when overnight anchors land.

Model registry: params serialize to JSON; sha256 of the canonical JSON is the artifact
hash registered on-chain (RiskRegistry.registerModel("gap@<version>", hash)).
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_VERSION = "gap-v0.1"

WEEKNIGHT_HOURS = 17.5
WEEKEND_HOURS = 65.5
EXTENDED_MIN_HOURS = 39.0  # anything >= this is "extended" (weekend/holiday)

REGIME_BOUNDS = [0.12, 0.20, 0.35]  # annualized EWMA vol: calm|normal|elevated|crisis
REGIMES = ["calm", "normal", "elevated", "crisis"]
DARK_TYPES = ["weeknight", "extended"]

EWMA_LAMBDA = 0.94
SHRINK_K = 60
COEFF_FLOOR = 1.0
COEFF_CAP = 2.5
PRECLOSE_RAMP_HOURS = 2.0


def load_sessions(csv_path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["Date"]).sort_values("Date").reset_index(drop=True)
    df["prev_close"] = df["Close"].shift(1)
    df["prev_date"] = df["Date"].shift(1)
    df["gap"] = np.log(df["Open"] / df["prev_close"])
    df["ret_cc"] = np.log(df["Close"] / df["prev_close"])
    # dark hours: prev close 16:00 ET -> this open 09:30 ET
    df["dark_hours"] = (df["Date"] - df["prev_date"]).dt.days * 24.0 - 6.5
    df["dark_type"] = np.where(df["dark_hours"] >= EXTENDED_MIN_HOURS, "extended", "weeknight")

    # EWMA annualized vol KNOWN AT THE PRIOR CLOSE (shifted: no lookahead)
    lam = EWMA_LAMBDA
    r2 = df["ret_cc"].fillna(0.0).to_numpy() ** 2
    ew = np.zeros_like(r2)
    seed = np.nanmean(r2[1:64]) if len(r2) > 64 else np.nanmean(r2[1:])
    ew[0] = seed
    for i in range(1, len(r2)):
        ew[i] = lam * ew[i - 1] + (1 - lam) * r2[i]
    df["ewma_vol_ann"] = np.sqrt(np.roll(ew, 1) * 252.0)  # uses info through i-1
    df.loc[0, "ewma_vol_ann"] = np.nan

    df["regime"] = pd.cut(
        df["ewma_vol_ann"],
        bins=[0.0] + REGIME_BOUNDS + [np.inf],
        labels=REGIMES,
    ).astype(str)
    return df.dropna(subset=["gap", "ewma_vol_ann"]).reset_index(drop=True)


@dataclass
class GapModelV0:
    version: str = MODEL_VERSION
    rms: dict = field(default_factory=dict)  # f"{dark}|{regime}" -> rms (log-gap)
    counts: dict = field(default_factory=dict)
    rms_ref: float = 0.0
    alpha: float = 0.0
    fitted_on: str = ""
    n_sessions: int = 0

    # ---------- fitting ----------

    @classmethod
    def fit(cls, df: pd.DataFrame) -> "GapModelV0":
        m = cls()
        m.n_sessions = len(df)
        m.fitted_on = f"{df['Date'].min().date()}..{df['Date'].max().date()}"

        def rms_of(x: pd.Series) -> float:
            return float(np.sqrt(np.mean(np.square(x)))) if len(x) else float("nan")

        marginal = {dt: rms_of(df.loc[df["dark_type"] == dt, "gap"]) for dt in DARK_TYPES}

        for dt in DARK_TYPES:
            for rg in REGIMES:
                cell = df[(df["dark_type"] == dt) & (df["regime"] == rg)]["gap"]
                n = len(cell)
                w = n / (n + SHRINK_K)
                cell_rms = rms_of(cell) if n else marginal[dt]
                m.rms[f"{dt}|{rg}"] = w * cell_rms + (1 - w) * marginal[dt]
                m.counts[f"{dt}|{rg}"] = n

        m.rms_ref = m.rms["weeknight|normal"]
        m.alpha = math.log(marginal["extended"] / marginal["weeknight"]) / math.log(
            WEEKEND_HOURS / WEEKNIGHT_HOURS
        )
        return m

    # ---------- inference ----------

    def coefficient(self, dark_type: str, regime: str, d_total: float, d_remaining: float) -> float:
        """Margin coefficient for a dark period of d_total hours with d_remaining left."""
        base = self.rms[f"{dark_type}|{regime}"] / self.rms_ref
        d_remaining = max(0.0, min(d_remaining, d_total))
        glide = (d_remaining / d_total) ** self.alpha if d_total > 0 and d_remaining > 0 else 0.0
        return float(min(COEFF_CAP, max(COEFF_FLOOR, base * glide))) if d_remaining > 0 else COEFF_FLOOR

    def sigma_implied(self, coeff: float) -> float:
        """Implied log-gap RMS for a published coefficient."""
        return coeff * self.rms_ref

    # ---------- registry artifact ----------

    def to_params(self) -> dict:
        return {
            "version": self.version,
            "fittedOn": self.fitted_on,
            "nSessions": self.n_sessions,
            "rms": {k: round(v, 8) for k, v in sorted(self.rms.items())},
            "counts": self.counts,
            "rmsRef": round(self.rms_ref, 8),
            "alpha": round(self.alpha, 6),
            "regimeBoundsAnnVol": REGIME_BOUNDS,
            "ewmaLambda": EWMA_LAMBDA,
            "shrinkK": SHRINK_K,
            "coeffFloor": COEFF_FLOOR,
            "coeffCap": COEFF_CAP,
            "precloseRampHours": PRECLOSE_RAMP_HOURS,
            "methodology": "RMS log-gap by darkType x volRegime, shrinkage K, power-law glide d^alpha",
        }

    def save(self, path: str | Path) -> str:
        payload = json.dumps(self.to_params(), sort_keys=True, separators=(",", ":"))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(self.to_params(), indent=2) + "\n")
        return "0x" + hashlib.sha256(payload.encode()).hexdigest()

    @classmethod
    def load(cls, path: str | Path) -> "GapModelV0":
        p = json.loads(Path(path).read_text())
        m = cls(version=p["version"], rms=p["rms"], counts=p["counts"], rms_ref=p["rmsRef"], alpha=p["alpha"])
        m.fitted_on = p["fittedOn"]
        m.n_sessions = p["nSessions"]
        return m

    def artifact_hash(self) -> str:
        payload = json.dumps(self.to_params(), sort_keys=True, separators=(",", ":"))
        return "0x" + hashlib.sha256(payload.encode()).hexdigest()


if __name__ == "__main__":
    data = Path(__file__).resolve().parents[1] / "data" / "spy_daily.csv"
    df = load_sessions(data)
    model = GapModelV0.fit(df)
    out = Path(__file__).resolve().parent / "params" / f"{MODEL_VERSION}.json"
    h = model.save(out)
    print(f"fitted {model.version} on {model.n_sessions} sessions ({model.fitted_on})")
    print(f"alpha={model.alpha:.4f}  rms_ref={model.rms_ref:.5f}")
    for k in sorted(model.rms):
        print(f"  {k:22s} rms={model.rms[k]:.5f}  n={model.counts[k]}")
    print("\nsample coefficients (start of period):")
    for dt, dtot in [("weeknight", WEEKNIGHT_HOURS), ("extended", WEEKEND_HOURS)]:
        for rg in REGIMES:
            c = model.coefficient(dt, rg, dtot, dtot)
            print(f"  {dt:10s} {rg:9s} -> {c:.3f}")
    print(f"\nparams -> {out}\nartifact hash: {h}")
