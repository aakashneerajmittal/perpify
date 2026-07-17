# Perpify risk services (Python)

See `../ARCHITECTURE.md` §4.3.

| Package | What it produces |
|---|---|
| `gap/` | Expected close-to-open gap distribution → margin coefficient (4h cadence in dark periods). Also powers the Weekly Gap Report. |
| `tier/` | Behavioral tier A–E with named contributing factors. v0 = calibrated scorecard, presented as provisional, refit on live data. |
| `sequencer/` | Reopen clearing plans + in-session pacing thresholds (M2–M3). |
| `confidence/` | Composite oracle confidence → reduce-only trigger (M2). |

All outputs are signed readings with a model version. The registry rule: every decision the
venue ever makes must be reproducible by replaying inputs through the named model version.

## Start here

```
pip install -r requirements.txt
python gap/fetch_data.py     # pulls ~30y of SPY daily data into data/
python gap/gap_stats.py      # first gap statistics (input to model + Gap Report #1)
```
