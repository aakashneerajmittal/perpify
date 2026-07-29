#!/usr/bin/env python3
"""Compute the CURRENT gap reading (and the upcoming dark-period glide schedule).

Emits JSON consumed by contracts/harness/post-reading.ts, which posts to RiskRegistry
on Base Sepolia. Session logic: NYSE hours 09:30-16:00 ET, weekends + 2026 US market
holidays. During open hours the coefficient is 1.0 until 2h before the close, then
ramps linearly into the upcoming dark period's initial value (the "Friday 4pm rule").

TESTNET v0 honesty: the regime is computed from the latest committed dataset; the
`dataAsOf` field states exactly how fresh that is. The ops loop refreshes the dataset
daily once the engine services run continuously (backlog item 5+).
"""
from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from model import (
    PRECLOSE_RAMP_HOURS,
    WEEKNIGHT_HOURS,
    GapModelV0,
    load_sessions,
)

ET = ZoneInfo("America/New_York")
HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "spy_daily.csv"
PARAMS = HERE / "params" / "gap-v0.1.json"
OUTDIR = HERE / "out"

HOLIDAYS_2026 = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
}

OPEN_T, CLOSE_T = time(9, 30), time(16, 0)


def is_trading_day(d: datetime) -> bool:
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in HOLIDAYS_2026


def next_open(after: datetime) -> datetime:
    d = after
    while True:
        candidate = datetime.combine(d.date(), OPEN_T, ET)
        if is_trading_day(candidate) and candidate > after:
            return candidate
        d += timedelta(days=1)


def prev_close(before: datetime) -> datetime:
    d = before
    while True:
        candidate = datetime.combine(d.date(), CLOSE_T, ET)
        if is_trading_day(candidate) and candidate < before:
            return candidate
        d -= timedelta(days=1)


def session_state(now: datetime) -> dict:
    trading_today = is_trading_day(now)
    in_hours = trading_today and OPEN_T <= now.timetz().replace(tzinfo=None) < CLOSE_T
    if in_hours:
        close_dt = datetime.combine(now.date(), CLOSE_T, ET)
        return {"session": "open", "close_dt": close_dt, "next_open": next_open(close_dt)}
    pc = prev_close(now)
    no = next_open(now)
    return {"session": "dark", "close_dt": pc, "next_open": no}


def classify(d_total_hours: float) -> str:
    return "extended" if d_total_hours >= 39.0 else "weeknight"


def main() -> None:
    model = GapModelV0.load(PARAMS)
    df = load_sessions(DATA)
    latest = df.iloc[-1]
    regime = str(latest["regime"])
    data_as_of = str(latest["Date"].date())

    now = datetime.now(ET)
    st = session_state(now)
    d_total = (st["next_open"] - st["close_dt"]).total_seconds() / 3600.0
    dark_type = classify(d_total)
    start_coeff = model.coefficient(dark_type, regime, d_total, d_total)

    if st["session"] == "open":
        hours_to_close = (st["close_dt"] - now).total_seconds() / 3600.0
        if hours_to_close <= PRECLOSE_RAMP_HOURS:
            frac = 1.0 - hours_to_close / PRECLOSE_RAMP_HOURS
            coeff = 1.0 + frac * (start_coeff - 1.0)
        else:
            coeff = 1.0
        session_label, hours_dark = "open", 0.0
    else:
        d_rem = (st["next_open"] - now).total_seconds() / 3600.0
        coeff = model.coefficient(dark_type, regime, d_total, d_rem)
        session_label = "weekend" if dark_type == "extended" else "weeknight"
        hours_dark = d_rem

    reading = {
        "market": "SPX-PERP",
        "gapCoefficient": round(coeff, 6),
        "session": session_label,
        "hoursDarkRemaining": round(hours_dark, 1),
        "darkType": dark_type,
        "regime": regime,
        "regimeVolAnn": round(float(latest["ewma_vol_ann"]), 4),
        "dataAsOf": data_as_of,
        "modelVersion": model.version,
        "artifactHash": model.artifact_hash(),
        "computedAt": now.isoformat(),
    }

    # upcoming Friday-close -> Monday-open glide (4h cadence) at the current regime
    friday_close = st["close_dt"]
    while friday_close.weekday() != 4:
        friday_close += timedelta(days=1)
        friday_close = datetime.combine(friday_close.date(), CLOSE_T, ET)
    monday_open = next_open(friday_close)
    wk_total = (monday_open - friday_close).total_seconds() / 3600.0
    schedule = []
    t = friday_close
    while t < monday_open:
        d_rem = (monday_open - t).total_seconds() / 3600.0
        schedule.append({
            "at": t.isoformat(),
            "hoursDarkRemaining": round(d_rem, 1),
            "gapCoefficient": round(model.coefficient(classify(wk_total), regime, wk_total, d_rem), 6),
        })
        t += timedelta(hours=4)

    OUTDIR.mkdir(exist_ok=True)
    (OUTDIR / "reading-current.json").write_text(json.dumps(reading, indent=2) + "\n")
    (OUTDIR / "schedule-next-weekend.json").write_text(json.dumps(schedule, indent=2) + "\n")
    print(json.dumps(reading, indent=2))
    print(f"\nweekend glide ({regime} regime): "
          + " -> ".join(f"{s['gapCoefficient']:.3f}" for s in schedule[:6]) + " …")


if __name__ == "__main__":
    main()
