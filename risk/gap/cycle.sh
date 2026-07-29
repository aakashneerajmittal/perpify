#!/usr/bin/env bash
# Risk service cycle: compute the current gap reading and post it on-chain.
# Cron-able; see docs/OPERATIONS.md. Exits non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")"
python3 publish.py
cd ../../contracts/harness
npx tsx post-reading.ts
