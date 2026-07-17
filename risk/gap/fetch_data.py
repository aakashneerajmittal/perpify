#!/usr/bin/env python3
"""Fetch ~30 years of SPY daily OHLC into risk/data/spy_daily.csv.

Primary source: Stooq (free, no key). Fallback: instruct the operator to download
manually — the CSV schema is Date,Open,High,Low,Close,Volume.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUT = DATA_DIR / "spy_daily.csv"

STOOQ_URL = "https://stooq.com/q/d/l/?s=spy.us&i=d"


def fetch_stooq() -> pd.DataFrame:
    r = requests.get(STOOQ_URL, timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    if "Date" not in df.columns or len(df) < 1000:
        raise ValueError(f"unexpected stooq payload: cols={list(df.columns)} rows={len(df)}")
    return df


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        df = fetch_stooq()
    except Exception as e:  # noqa: BLE001
        print(f"[fetch_data] stooq failed: {e}", file=sys.stderr)
        print(
            "[fetch_data] fallback: download https://stooq.com/q/d/l/?s=spy.us&i=d manually "
            f"and save as {OUT}",
            file=sys.stderr,
        )
        return 1

    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    df.to_csv(OUT, index=False)
    print(f"[fetch_data] saved {len(df)} rows {df['Date'].min().date()} → {df['Date'].max().date()} to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
