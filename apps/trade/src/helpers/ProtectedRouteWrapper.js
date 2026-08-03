/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { hasWallet, PERPIFY_AUTH_EVENT } from "@/config/perpifySession";

/**
 * PERPIFY testnet: authentication is the connected/burner wallet, not SuperTokens. Show the
 * protected page when a wallet is connected; otherwise send the visitor to the trade screen,
 * which carries the Connect Wallet flow.
 *
 * (Density's SuperTokens session gate — Session.doesSessionExist() + 2FA — is retired here: the
 * burner wallet never has a SuperTokens session, so the gate always failed and blanked every
 * protected page, most visibly the Portfolio page which rendered as an empty screen.)
 */
function ProtectedRouteWrapper(props) {
  const navigate = useNavigate();
  const [showUI, setShowUI] = useState(hasWallet());

  useEffect(() => {
    const check = () => {
      if (hasWallet()) {
        setShowUI(true);
      } else {
        setShowUI(false);
        navigate("/");
      }
    };
    check();
    window.addEventListener(PERPIFY_AUTH_EVENT, check);
    return () => window.removeEventListener(PERPIFY_AUTH_EVENT, check);
  }, []);

  return showUI ? props.children : null;
}

export default ProtectedRouteWrapper;
