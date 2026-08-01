/**
 * PERPIFY testnet auth.
 *
 * The original Density app gated the UI on a SuperTokens session
 * (Session.doesSessionExist + a "2fa-completed" claim). On the Perpify testnet there is no
 * password/2FA server — identity is a burner wallet address in localStorage (see
 * config/perpifySession). useCheckLoginStatus now reflects that, and re-checks whenever the
 * session changes (the "perpify-auth-changed" event) or another tab writes localStorage.
 */
import { GetAppURL } from "../../../../frontend-api-service/Base";
import { useEffect, useState } from "react";
import { hasWallet, disconnectWallet, PERPIFY_AUTH_EVENT } from "@/config/perpifySession";

export const useCheckLoginStatus = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(hasWallet());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sync = () => setIsLoggedIn(hasWallet());
    sync();
    setIsLoading(true);
    window.addEventListener(PERPIFY_AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PERPIFY_AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { isLoggedIn, isLoading };
};

export const logoutApp = async () => {
  disconnectWallet();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.location.href = GetAppURL();
};
