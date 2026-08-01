import { getWallet } from "@/config/perpifySession";

/**
 * PERPIFY testnet: the "token" the account WebSocket authenticates with IS the burner
 * wallet address. The engine keys the demo account off it (and funds it on first connect).
 * `type` ("websocket" | "rest") is ignored — one identity for the whole session.
 * Returns "" when logged out; callers only request a token once a wallet exists.
 */
export const GENERATE_TOKEN = async () => {
  return getWallet() || "";
};
