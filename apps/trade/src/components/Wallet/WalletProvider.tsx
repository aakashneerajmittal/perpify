/**
 * WalletProvider — wraps the app in wagmi + react-query, bridges wagmi connection
 * state into perpifySession, and owns the Connect-wallet modal state.
 *
 * Usage: wrap <App/> once (see index.tsx). Anywhere below, call useConnectModal()
 * to open the modal.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/config/wagmi";
import { setWallet, disconnectWallet, getWallet, getWalletMode, isRealWallet } from "@/config/perpifySession";
import ConnectWalletModal from "./ConnectWalletModal";

const queryClient = new QueryClient();

type ModalCtx = { open: () => void; close: () => void; isOpen: boolean };
const ConnectModalContext = createContext<ModalCtx>({ open: () => {}, close: () => {}, isOpen: false });
export const useConnectModal = () => useContext(ConnectModalContext);

/**
 * One-way sync: wagmi → session.
 *  - connected real wallet   → setWallet(address, "real")  (engine login + $100k)
 *  - real wallet disconnects → disconnectWallet()
 * Demo-wallet sessions (mode "demo") are never touched here, and we ignore the
 * transient "connecting"/"reconnecting" states so a page reload doesn't log the
 * user out before wagmi finishes reconnecting.
 */
function WalletSessionBridge() {
  const { address, status } = useAccount();
  useEffect(() => {
    if (status === "connected" && address) {
      if (getWallet() !== address.toLowerCase() || !isRealWallet()) {
        setWallet(address, "real");
      }
    } else if (status === "disconnected") {
      if (getWalletMode() === "real") disconnectWallet();
    }
  }, [address, status]);
  return null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const ctx = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectModalContext.Provider value={ctx}>
          <WalletSessionBridge />
          {children}
          <ConnectWalletModal open={isOpen} onClose={close} />
        </ConnectModalContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
