/**
 * Perpify feature flags — the single switchboard for what's live on the testnet.
 *
 * FOUNDER DIRECTIVE (Jul 31): keep ALL of Density's features in the codebase — News,
 * Rebate, Referral, Onboarding, KYC, fiat, copy-trading, everything. Do NOT delete them.
 * For the testnet phase they are simply switched OFF here: hidden from navigation and
 * gated at the route level ("coming soon"), with every line of code and every asset
 * retained. Flip a flag back to `true` to bring a feature back — nothing to rebuild.
 *
 * Only the SPX-PERP trade screen (and the account plumbing it needs) ships live now.
 */
export const FEATURES = {
  // live on testnet
  trade: true, // the SPX-PERP trading screen — the product
  positions: true, // open positions / orders / PnL tables
  portfolio: true, // read-only portfolio view (kept on; harmless)

  // KEPT in code, switched OFF for the testnet phase (hidden + route-gated "coming soon")
  news: false,
  rebate: false,
  referral: false,
  onboarding: false, // product tour / marketing onboarding (auth is handled separately → wallet)
  rewards: false,
  leaderboard: false,
  kyc: false,
  fiat: false, // INR/USDT deposit-withdraw, bank accounts, conversions
  signalTrading: false, // copy / signal trading
  apiManagement: false,
  settings: true, // basic settings kept; sub-tabs for disabled features hide themselves
  multiSymbolWatchlist: false, // single market (SPX-PERP) for now

  // Real EIP-712 wallet-signature order auth (auth-v1). The engine verifies signatures when
  // present and is fully tested; the frontend signing path is BUILT and ready but shipped OFF
  // so the demo (which uses the instant demo wallet, no injected signer) is untouched. Flip to
  // true to require real connected wallets to sign each market/limit order with their wallet.
  signedOrders: false,
};

/** helper for nav/route guards: is this feature reachable right now? */
export const isEnabled = (key) => FEATURES[key] === true;

/**
 * Wiring plan (applied during frontend-adoption step 6, once the app boots):
 *  - navigation: hide menu entries where !isEnabled(key)
 *  - routing: wrap disabled routes in a <ComingSoon/> gate instead of removing them
 *  - any in-page entry points (buttons/links) to disabled features: hidden or disabled
 * The code and assets behind each flag stay in place, untouched.
 */
export default FEATURES;
