import { Format } from "./String";

// Perpify symbol icons are bundled locally (public/symbol-icons). The old Density CDN
// (static-dev.density.exchange) has no Perpify markets, so every symbol icon 404'd and showed
// a broken image. These are served from our own origin, so they always load.
const ICON_URL = "/symbol-icons/{0}.svg";
export const FALLBACK_ICON = "/symbol-icons/default.svg";

// Normalize any market form to the short ticker so every caller resolves the same file:
//   "SPX-PERP" / "SPXUSDT" / "SPX"  ->  spx  ->  /symbol-icons/spx.svg
// (MarketRail strips -PERP; the SideMenu rows don't — this makes both agree.)
export const getCurrencyUrl = (symbol) => {
  const key = String(symbol || "")
    .toLowerCase()
    .replace(/-perp$/, "")
    .replace(/-usd$/, "")
    .replace(/usdt$/, "")
    .trim();
  return Format(ICON_URL, key || "default");
};

/* Usage : Pass a currency/Symbol (with or without base asset / -PERP suffix). */
