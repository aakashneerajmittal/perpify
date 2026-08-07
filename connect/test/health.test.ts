import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startConnectServer } from "../src/server.js";

let server: Server;
let base: string;

beforeAll(async () => {
  // mock transport so the service never touches the network during the test
  server = startConnectServer(0, { transport: async () => ({ status: 200, json: { data: [] } }) });
  if (!server.listening) await new Promise<void>((res) => server.on("listening", () => res()));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  server?.close();
});

describe("connect service HTTP surface", () => {
  it("GET /health → 200 ok (Render health check)", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it("unknown route → 404", async () => {
    const r = await fetch(`${base}/nope`);
    expect(r.status).toBe(404);
  });

  it("POST /connect/history with missing creds → ok:false, no crash", async () => {
    const r = await fetch(`${base}/connect/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exchange: "okx" }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });
});
