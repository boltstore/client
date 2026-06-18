import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient } from "../../src/client";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(response: { status?: number; body?: unknown }) {
  globalThis.fetch = async () => {
    const body = JSON.stringify(response.body ?? {});
    return new Response(body, {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("BoltstoreClient — health", () => {
  beforeAll(() => {
    mockFetch({ body: { data: { status: "ok", version: "1.0.0", uptime: 123, timestamp: "2024-01-01T00:00:00Z" } } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("health.check returns status", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    const health = await client.health.check();
    expect(health.status).toBe("ok");
    expect(health.version).toBe("1.0.0");
  });
});
