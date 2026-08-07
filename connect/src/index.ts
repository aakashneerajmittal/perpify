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
export { signBinanceQuery, signBybit, signOkx, okxTimestamp } from "./sign.js";
export {
  fetchTradeHistory,
  fetchTransport,
  type Creds,
  type Transport,
  type HttpRequest,
  type HttpResponse,
  type FetchOpts,
} from "./client.js";
export {
  runConnect,
  createConnectHandler,
  startConnectServer,
  type ConnectInput,
  type ConnectResult,
  type ConnectSummary,
  type ConnectDeps,
} from "./server.js";
export { extractFeatures, featureVector, FEATURES, type FeatureMap, type FeatureName } from "./features.js";
export { canonicalTierMessage, signTierAttestation, type TierAttestation } from "./attest.js";
export {
  scoreTrader,
  toTierReading,
  loadModel,
  rawPredict,
  scoreOf,
  tierOf,
  attribution,
  nearestArchetype,
  type DnaModel,
  type ScoredTrader,
  type TierFactor,
} from "./score.js";
