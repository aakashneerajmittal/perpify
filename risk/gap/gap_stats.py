#!/usr/bin/env python3
"""First-pass gap statistics from SPY daily data.

Gap definition: today's Open vs yesterday's Close (the overnight/weekend "dark period" move).
Weekend = previous trading day is >1 calendar day back (Mon open vs Fri close, holidays too).

These numbers feed (a) the gap model calibration, (b) Weekly Gap Report #1,
(c) a fact-check of the deck's "38% of days open with a gap > 0.5%" claim.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data" / "spy_daily.csv"


def load() -> pd.DataFrame:
    df = pd.read_csv(DATA, parse_dates=["Date"]).sort_values("Date").reset_index(drop=True)
    df["prev_close"] = df["Close"].shift(1)
    df["prev_date"] = df["Date"].shift(1)
    df["gap"] = df["Open"] / df["prev_close"] - 1.0
    df["dark_days"] = (df["Date"] - df["prev_date"]).dt.days
    df = df.dropna(subset=["gap"]).copy()
    df["kind"] = np.where(df["dark_days"] >= 3, "weekend/holiday", "weeknight")
    return df


def describe(g: pd.Series, label: str) -> None:
    a = g.abs()
    print(f"\n== {label} (n={len(g)}) ==")
    print(f"  mean |gap|        : {a.mean():.4%}")
    print(f"  median |gap|      : {a.median():.4%}")
    print(f"  std of gap        : {g.std():.4%}")
    print(f"  P(|gap| > 0.5%)   : {(a > 0.005).mean():.2%}")
    print(f"  P(|gap| > 1.0%)   : {(a > 0.010).mean():.2%}")
    print(f"  P(|gap| > 2.0%)   : {(a > 0.020).mean():.2%}")
    print(f"  99th pct |gap|    : {a.quantile(0.99):.4%}")
    print(f"  worst down gap    : {g.min():.4%}")
    print(f"  worst up gap      : {g.max():.4%}")


def main() -> None:
    df = load()
    yrs = (df["Date"].max() - df["Date"].min()).days / 365.25
    print(f"SPY daily {df['Date'].min().date()} → {df['Date'].max().date()}  (~{yrs:.1f} years, {len(df)} sessions)")

    describe(df["gap"], "ALL gaps")
    describe(df.loc[df["kind"] == "weeknight", "gap"], "WEEKNIGHT gaps (~17.5h dark)")
    describe(df.loc[df["kind"] == "weekend/holiday", "gap"], "WEEKEND/HOLIDAY gaps (~65.5h+ dark)")

    print("\n== 10 largest absolute gaps ==")
    top = df.reindex(df["gap"].abs().sort_values(ascending=False).index)[["Date", "gap", "kind"]].head(10)
    for _, r in top.iterrows():
        print(f"  {r['Date'].date()}  {r['gap']:+.2%}  ({r['kind']})")

    thesis = (df["gap"].abs() > 0.005).mean()
    print(f"\n[fact-check] deck claim '38% of days gap >0.5%': measured = {thesis:.1%}")


if __name__ == "__main__":
    main()
