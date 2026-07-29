# Perpify — The One List

**Rule:** work strictly top to bottom. One item in flight. Anything new gets APPENDED, not
acted on, unless it blocks the current item. An item is done only when its done-check passes.

| # | Who | Item | Done when |
|---|-----|------|-----------|
| 1 | ✅ DONE Jul 29 | ~~Faucet drip~~ — funded 0.2 ETH from Aakash's demo wallet | Verified: deployer balance 0.2 ETH |
| 2 | Aakash (1 min) | Delete the classic GitHub token (github.com/settings/tokens) — Density audit is done | Token gone from the settings page |
| 3 | ✅ DONE Jul 29 | ~~Deploy all six contracts to Base Sepolia~~ | Live + smoke-tested; see `docs/deployments.md`; gas 0.000026 ETH |
| 4 | ✅ DONE Jul 29 | ~~Gap model v0~~ — fit + OOS backtest (`risk/gap/BACKTEST.md`) + publish pipeline; first live reading + `gap@v0.1` artifact hash posted to RiskRegistry on Base Sepolia | All three done-checks passed; 99% tail breaches 2.5% vs static 4.8%, median coeff 1.000 |
| 5 | ✅ DONE Jul 29 | ~~Engine ↔ chain~~ — epoch 1 settled on Sepolia (root verified byte-identical on read-back); risk cycle service posting live readings; `docs/OPERATIONS.md` + cron lines | Both done-checks passed by service runs, zero hand-entered values |
| 6 | Claude | Engine speaks the Density wire protocol (ws/api layer adopts the audited message shapes) | WS serves book/orders/account in those shapes; tests green |
| 7 | Aakash (5 min) | Send the cofounder reuse-permission email (Claude drafts it as part of this item) | Cofounder replies yes in writing |
| 8 | Claude | Maker bot (quotes around index, spread widens with gap coefficient) + taker bots | Live book on Sepolia sustained through a full weekend, unattended |
| 9 | Both | **M1 milestone demo**: scripted session on Sepolia — deposit → trade → weekend coefficient rises → gap prints → liquidation with signed explainer on-chain → conservation + replay checks | Aakash watches it run end-to-end; replay byte-identical. **M1 complete.** |
| 10 | Aakash (15 min) | TradingView Charting Library license application (Claude supplies exact steps) | Application submitted (approval arrives async, needed by M2 chart work) |
| 11 | Claude | M2 start — fresh frontend shell (wallet-connect) + first Density harvest: live book + order ticket against our engine | Aakash connects his wallet in a browser and sees the live book |
| 12 | Claude | Tier v0 wired in and visible: two wallets, same trade, different margin, factors shown | Aakash reproduces it himself in the UI |
| 13 | Claude | Public dashboard v0: live gap coefficient + venue state (the future gaps.perpify.trade) | Page loads publicly with live readings |
| 14 | Aakash (30 min) | Write the private list of 20 traders you know (future closed-testnet cohort) | List exists (nobody contacted yet) |
| 15 | Both | M3 planning session: sequencer + March-2020 replay + passport + MCP server, re-scoped against everything learned | Next version of this list written |

**Parking lot (appended, not in flight):** margin cross-check vs Density bracket math (fold
into item 4); deck stat correction 38%→28.5% (fold into first investor-material rewrite);
Weekly Gap Report #1 (unlocks after item 4).

*Updated: July 29, 2026 · lives in repo (`docs/BACKLOG.md`) and the Perpify project.*
