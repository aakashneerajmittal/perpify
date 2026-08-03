# @perpify/sdk — client + MCP server

A typed TypeScript client for the Perpify engine, and a Model Context Protocol (MCP) server
that exposes the venue to AI agents.

## Client

```ts
import WebSocket from "ws";
import { PerpifyClient } from "./perpifyClient.js";

const c = new PerpifyClient({ engineWs: "wss://perpify-engine.onrender.com", wallet: "0x…", WebSocketImpl: WebSocket });
await c.connect();
c.onAccount((a) => console.log(a.balances, a.positions));
c.onLiquidation((x) => console.log("liquidated:", x));
c.placeOrder({ symbol: "NVDA-PERP", side: "buy", qty: 0.5, price: 190, tif: "IOC" });
c.placeTrigger({ symbol: "NVDA-PERP", side: "sell", qty: 0.5, triggerPx: 170, triggerAbove: false }); // stop-loss
```

In the browser, omit `WebSocketImpl` (uses the global `WebSocket`).

## MCP server

A dependency-light stdio MCP server (newline-delimited JSON-RPC 2.0). Tools:

- `simulate_margin(notionalUsd, tier, gapCoefficient)` — IM / MM / collateral / effective leverage.
- `lookup_behavioral_tier(address)` — provisional A–E tier, multiplier, named factors.
- `query_risk_state(market)` — live gap coefficient + session for a market.
- `read_venue_health()` — service status + market list + sequence number.
- `place_order(wallet, symbol, side, qty, price, tif?, reduceOnly?)` — trade over the account WS.

Run:

```
PERPIFY_ENGINE_WS=wss://perpify-engine.onrender.com npx tsx sdk/mcpServer.ts
```

Wire into an MCP client (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "perpify": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/perpify/sdk/mcpServer.ts"],
      "env": { "PERPIFY_ENGINE_WS": "wss://perpify-engine.onrender.com" }
    }
  }
}
```

Then an agent can ask, e.g., *"what margin would a $20k NVDA long need at tier D?"* or
*"place a 0.3 NVDA-PERP market buy"* and the venue answers/executes. On-thesis: the venue is
an API for agents, not just humans.
