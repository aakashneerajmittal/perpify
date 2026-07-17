# Perpify contracts (Base Sepolia)

See `../ARCHITECTURE.md` §4.1 for responsibilities and the trust model (§3).

| Contract | One-liner |
|---|---|
| `PerpVault.sol` | USDC custody; deposits; withdrawal of free collateral |
| `Settlement.sol` | Epoch batches (PnL/funding/fees/liqs) + state roots + event trail |
| `PVaultTranches.sol` | Senior/Junior accounting, epoch NAV, yield curve, 48h Junior lock, catastrophe mode |
| `OracleAdapter.sol` | Pyth primary + Chainlink check + signed confidence/gap-coefficient state + reduce-only flag |
| `RiskRegistry.sol` | Signed risk readings, liquidation explainer hashes, model version registry |
| `MockUSDC.sol` | TESTNET: mintable USDC with faucet |

Conventions:
- Every testnet simplification is marked `// TESTNET:` with the mainnet replacement noted.
- All value flows emit events; the venue's public memory is the event trail.
- Fuzz tests on tranche waterfall + margin accounting are part of M1's definition of done.

Toolchain: Foundry (`forge build`, `forge test`). Deploy scripts in `script/`.
