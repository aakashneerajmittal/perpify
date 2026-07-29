# Perpify Deployments

## Base Sepolia (testnet V1) — deployed July 29, 2026

Operator/deployer: `0xecBa1161598A7b931B43DF11b9ab163931C54427` (TESTNET single ops key; multisig at mainnet per trust model §3)

| Contract | Address | Explorer |
|---|---|---|
| MockUSDC | `0x7eD361C00412BB32B867a46119838e40C480f2Ae` | [basescan](https://sepolia.basescan.org/address/0x7eD361C00412BB32B867a46119838e40C480f2Ae) |
| PerpVault | `0x76600D3138e0D6B3cF088b02D84f02e7F4Ad7cB2` | [basescan](https://sepolia.basescan.org/address/0x76600D3138e0D6B3cF088b02D84f02e7F4Ad7cB2) |
| Settlement | `0xB6703a8822AB7113EBcAa35830C7b22AE2204c43` | [basescan](https://sepolia.basescan.org/address/0xB6703a8822AB7113EBcAa35830C7b22AE2204c43) |
| RiskRegistry | `0xa4Db0eF215F18305d453Ed329A0Bb7CC48EADbdE` | [basescan](https://sepolia.basescan.org/address/0xa4Db0eF215F18305d453Ed329A0Bb7CC48EADbdE) |
| OracleAdapter | `0xBA70aD8b373924924623974a464C156945bcD5Cb` | [basescan](https://sepolia.basescan.org/address/0xBA70aD8b373924924623974a464C156945bcD5Cb) |
| PVaultTranches | `0x4CcfF8169da1c88c22AB7660FaDA23F28f5DBEb2` | [basescan](https://sepolia.basescan.org/address/0x4CcfF8169da1c88c22AB7660FaDA23F28f5DBEb2) |

Machine-readable: `contracts/deployments/base-sepolia.json`.

Genesis state posted at deploy: oracle price 5000.00 (TestnetFeed), gap coefficient 1.000000
(`gap-v0.0-genesis`), settlement authorized in vault, first faucet mint executed.
Gas spent for the entire deployment + smoke tests: 0.000026 ETH.

Source verification on Basescan: pending (needs BASESCAN_API_KEY — parked; not blocking).
