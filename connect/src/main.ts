/**
 * Entrypoint for the read-only Trader-DNA connect service (the "only server surface").
 * Boots the HTTP API: GET /health and POST /connect/history.
 *
 * Read-only + EPHEMERAL by design (decision, Aug 7): a user's read-only API key is used to sign the
 * one fetch-and-score request, then discarded — nothing is persisted. "Always-fresh re-scoring"
 * (which would need stored keys) is a later, opt-in feature behind KMS-encrypted storage.
 *
 * Env:
 *   PORT                 listen port (default 8787)
 *   CONNECT_ATTEST_KEY   (mainnet) private key the service signs verified tier readings with; the
 *                        engine verifies against its CONNECT_ATTEST_PUBKEY. Unset on testnet.
 */
import { startConnectServer } from "./server.js";

const PORT = Number(process.env.PORT) || 8787;
startConnectServer(PORT);
// eslint-disable-next-line no-console
console.log(`[perpify-connect] read-only connect service listening on :${PORT} (ephemeral keys; read-only)`);
