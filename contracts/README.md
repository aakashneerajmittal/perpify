# Perpify contracts (Base Sepolia)

See `../ARCHITECTURE.md` §4.1 for responsibilities and §3 for the trust model.

| Contract | One-liner | Status |
|---|---|---|
| `MockUSDC.sol` | TESTNET: mintable USDC with 10k/day faucet | ✅ tested |
| `PerpVault.sol` | USDC custody; deposits; authorized payouts; event trail | ✅ tested |
| `Settlement.sol` | Sequential epoch roots (state + event chain) + payout batches | ✅ tested |
| `RiskRegistry.sol` | Gap/confidence readings, liquidation explainer hashes, model registry | ✅ tested |
| `OracleAdapter.sol` | v0 operator-push price behind the stable interface; fail-closed staleness | ✅ tested |
| `PVaultTranches.sol` | Senior/Junior waterfall, yield curve, generations, catastrophe mode | ✅ tested |

Conventions: every testnet simplification is marked `// TESTNET:` with the mainnet
replacement noted; all value flows emit events.

## Testing — two harnesses

**Cloud harness (runs anywhere, no toolchain downloads):** solc-js + ethereumjs VM.

```
cd harness && npm install && npm test
```

18 tests: custody/auth, epoch sequencing, registry, oracle staleness, and the tranche
waterfall — scenario A/B, dynamic yield curve, junior wipe → generation bump → catastrophe
mode → 1% senior exit fee → recapitalization → recovery, insolvency halt, plus a 150-op
fuzz asserting the conservation invariant after every operation:

```
usdc.balanceOf(tranches) == seniorNav + juniorNav + yieldReserve   // always, exactly
```

**Foundry (local dev, richer fuzzing):** `foundry.toml` is configured; add `forge test`
mirrors of the harness suites when working locally (cloud sandbox cannot download the
Foundry binaries — first Claude Code session task).

## Deploying to Base Sepolia

1. `cp .env.example .env` and fill in the testnet-only `PRIVATE_KEY`.
2. Fund the deployer with Base Sepolia ETH (faucet).
3. Public RPC `https://sepolia.base.org` works for deployment — no API-key dependency.
4. Deploy order: MockUSDC → PerpVault(op, usdc) → Settlement(op, vault) →
   vault.setAuthorized(settlement) → RiskRegistry(op) → OracleAdapter(op) →
   PVaultTranches(op, usdc).
