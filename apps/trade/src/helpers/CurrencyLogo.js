import { Format } from "./String";

// Perpify symbol icons are bundled locally (public/symbol-icons). The old Density CDN
// (static-dev.density.exchange) has no Perpify markets, so every symbol icon 404'd and showed
// a broken image. These are served from our own origin, so they always load.
const ICON_URL = "/symbol-icons/{0}.svg";
export const FALLBACK_ICON = "/symbol-icons/default.svg";

export const getCurrencyUrl = (symbol) => Format(ICON_URL, String(symbol || "").toLowerCase());

/* Usage : Pass a currency/Symbol in lower case without the base asset. */
