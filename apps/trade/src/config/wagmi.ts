/**
 * wagmi config — wallet connection for the Perpify testnet.
 *
 * Connect-only: the testnet matching engine is off-chain and keys accounts by the
 * connected address (funded $100k on first connect in --demo mode), so we never
 * send an on-chain transaction here. wagmi just gives us a real MetaMask / Coinbase /
 * WalletConnect connection and the user's address, which becomes the engine token
 * via perpifySession.setWallet().
 *
 * WalletConnect (mobile-wallet QR) activates only when VITE_WALLETCONNECT_PROJECT_ID
 * is set (free at cloud.walletconnect.com). Without it, injected wallets (MetaMask,
 * Rabby, Brave, …) and Coinbase Wallet still work, plus the demo-wallet fallback.
 */
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcProjectId: string = ((import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID as string) || "";

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: "Perpify", appLogoUrl: "https://demo.perpify.trade/favicon.svg" }),
  ...(wcProjectId
    ? [
        walletConnect({
          projectId: wcProjectId,
          showQrModal: true,
          metadata: {
            name: "Perpify",
            description: "AI-priced 24/7 perpetuals on the S&P 500 and top US stocks",
            url: "https://demo.perpify.trade",
            icons: ["https://demo.perpify.trade/favicon.svg"]
          }
        })
      ]
    : [])
];

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  connectors,
  transports: {
    [base.id]: http(),
    [mainnet.id]: http()
  }
});

export const hasWalletConnect = !!wcProjectId;
