/**
 * perpifySession — testnet burner-wallet identity, kept in localStorage.
 *
 * There are no real keys and no real funds here. A burner "address" is just a stable,
 * random 0x-address-shaped id that the Perpify engine uses to key a demo account (funded
 * with testnet collateral on first connect, in the engine's --demo mode). It stands in for
 * SuperTokens / real wallet-signature auth while we run the public testnet; production auth
 * (EIP-712 wallet signatures) replaces this without the rest of the app noticing, because
 * everything downstream only ever sees "the address".
 *
 * The engine's resolveToken() accepts exactly /^0x[0-9a-fA-F]{40}$/, so connectWallet()
 * mints precisely that. The account WebSocket connects with `?token=<address>`, and
 * GENERATE_TOKEN() returns this same address.
 *
 * Login state changes are broadcast via a window "perpify-auth-changed" event so every
 * useCheckLoginStatus() consumer re-renders without a full navigation/reload.
 */

const WALLET_KEY = "perpify_wallet";
const MODE_KEY = "perpify_wallet_mode"; // "real" (connected wallet) | "demo" (burner)
export const PERPIFY_AUTH_EVENT = "perpify-auth-changed";

export type WalletMode = "real" | "demo";

function randomAddress(): string {
  const bytes = new Uint8Array(20);
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      // Non-crypto fallback (testnet ids only — never used for signing).
      for (let i = 0; i < bytes.length; i++) bytes[i] = (performance.now() * (i + 7)) & 0xff;
    }
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
  }
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return "0x" + hex;
}

export function getWallet(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(WALLET_KEY) : null;
  } catch {
    return null;
  }
}

export function hasWallet(): boolean {
  return !!getWallet();
}

function broadcast(): void {
  try {
    window.dispatchEvent(new Event(PERPIFY_AUTH_EVENT));
  } catch {
    /* SSR / no window */
  }
}

export function getWalletMode(): WalletMode | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage.getItem(MODE_KEY) as WalletMode | null) : null;
  } catch {
    return null;
  }
}

/** True when the session is a connected real wallet (vs the demo burner). */
export function isRealWallet(): boolean {
  return getWalletMode() === "real";
}

/**
 * Log the session in with a real connected wallet address (from wagmi/MetaMask/etc).
 * The address is lowercased so the engine token is stable across reconnects (its
 * resolveToken accepts /^0x[0-9a-fA-F]{40}$/). Returns the stored token.
 */
export function setWallet(address: string, mode: WalletMode = "real"): string {
  const addr = (address || "").trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("perpifySession.setWallet: invalid address");
  }
  try {
    localStorage.setItem(WALLET_KEY, addr);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode — session lives for this page only */
  }
  broadcast();
  return addr;
}

/** Mint (or reuse) the demo burner wallet and mark the session logged-in. Returns the address. */
export function connectWallet(): string {
  let addr = getWallet();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    addr = randomAddress();
    try {
      localStorage.setItem(WALLET_KEY, addr);
    } catch {
      /* private mode — keep the address in memory only for this page life */
    }
  }
  try {
    localStorage.setItem(MODE_KEY, "demo");
  } catch {
    /* ignore */
  }
  broadcast();
  return addr;
}

/** Forget the wallet (logout). Keeps everything else in localStorage intact. */
export function disconnectWallet(): void {
  try {
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
  broadcast();
}
