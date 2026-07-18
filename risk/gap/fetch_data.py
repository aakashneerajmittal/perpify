#!/usr/bin/env python3
"""Fetch ~30 years of SPY daily OHLC into risk/data/spy_daily.csv.

Source: Yahoo Finance via yfinance (free, no key). Stooq was the original primary
source but its CSV endpoint now returns 404, so it has been dropped.

Schema: Date,Open,High,Low,Close,Volume

Note on adjustment: auto_adjust=False keeps OHLC at actual traded levels rather
than back-adjusting for dividends. SPY has never split (verified: zero split events
on record), so there is no split artifact to correct for. The only adjustment
artifact this leaves is a small (~0.3-0.4%) drop on the 4 ex-dividend days per
year, which sits below the 0.5% threshold the gap stats key on.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUT = DATA_DIR / "spy_daily.csv"

TICKER = "SPY"
START = "1995-01-01"
COLUMNS = ["Date", "Open", "High", "Low", "Close", "Volume"]


def fetch_yfinance() -> pd.DataFrame:
    df = yf.download(
        TICKER,
        start=START,
        auto_adjust=False,
        progress=False,
        multi_level_index=False,
    )
    if df is None or df.empty:
        raise ValueError("yfinance returned no data")

    df = df.reset_index()
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"unexpected yfinance payload: missing {missing}, got {list(df.columns)}")

    df = df[COLUMNS]
    if len(df) < 1000:
        raise ValueError(f"suspiciously few rows from yfinance: {len(df)}")
    return df


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        df = fetch_yfinance()
    except Exception as e:  # noqa: BLE001
        print(f"[fetch_data] yfinance failed: {e}", file=sys.stderr)
        return 1

    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    df = df.dropna(subset=["Open", "Close"])
    df.to_csv(OUT, index=False)
    print(f"[fetch_data] saved {len(df)} rows {df['Date'].min().date()} → {df['Date'].max().date()} to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
