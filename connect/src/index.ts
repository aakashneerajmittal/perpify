/**
 * @perpify/connect — read-only Trader-DNA connect, server-side ingestion + reconstruction core.
 *
 * Pipeline: exchange trade history (JSON) → normalize() → Fill[] → reconstruct() → RoundTrip[] →
 * (trader-dna features.py / model) → verified provisional tier. This package owns the first two
 * stages — the data layer — with no secrets and no network; the live signed fetch and the HTTP
 * endpoint are thin layers built on top (next chunk).
 */
export type { Fill, RoundTrip, EnrichHooks, Exchange } from "./types.js";
export { reconstruct, setEquity } from "./reconstruct.js";
export { normalize, normalizeBinance, normalizeBybit, normalizeOkx, normSymbol } from "./normalizers.js";
