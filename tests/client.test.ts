import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient, BoltstoreError } from "../src/client";
import { ClientQueryBuilder } from "../src/query-builder";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(response: { status?: number; body?: unknown; headers?: Record<string, string> }) {
  globalThis.fetch = async () => {
    const body = JSON.stringify(response.body ?? {});
    return new Response(body, {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json", ...response.headers },
    });
  };
}

function mockFetchError(status: number, body?: string, contentType?: string) {
  globalThis.fetch = async () => {
    return new Response(body ?? "Internal Server Error", {
      status,
      headers: { "Content-Type": contentType ?? "text/html" },
    });
  };
}

describe("BoltstoreClient — dbPath", () => {
  test("includes databaseId in path when set", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_abc" });
    expect(client.dbPath("/collections")).toBe("/api/dbs_abc/collections");
  });

  test("strips trailing slash from baseUrl", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080/", databaseId: "dbs_abc" });
    expect(client.dbPath("/health")).toBe("/api/dbs_abc/health");
  });

  test("uses databaseId in path", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_abc" });
    expect(client.dbPath("/collections")).toBe("/api/dbs_abc/collections");
  });
});

describe("BoltstoreClient — createQuery", () => {
  test("returns a ClientQueryBuilder", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const qb = client.createQuery();
    expect(qb).toBeInstanceOf(ClientQueryBuilder);
  });

  test("sends POST request to /query endpoint", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: string, init: RequestInit) => {
      capturedUrl = url as string;
      capturedMethod = init.method ?? "";
      capturedBody = init.body ? JSON.parse(init.body as string) : undefined;
      return new Response(JSON.stringify({ data: [{ id: "1", name: "test" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
      const qb = client.createQuery();
      qb.from("items");
      await qb.where("name", "test").get();
      expect(capturedUrl).toBe("http://localhost:8080/api/dbs_app/query");
      expect(capturedMethod).toBe("POST");
      expect(capturedBody).toHaveProperty("collection", "items");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("BoltstoreClient — request", () => {
  beforeAll(() => {
    mockFetch({ body: { data: { id: "1", name: "test" } } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("sends GET request and returns data", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    const res = await client.request("GET", "/api/test");
    expect(res.data).toEqual({ id: "1", name: "test" });
  });

  test("sends Accept header", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = (init.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    await client.request("GET", "/api/test");
    expect(capturedHeaders["Accept"]).toBe("application/json");
  });

  test("sends Authorization header when token is set", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = (init.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token: "my-token" });
    await client.request("GET", "/api/test");
    expect(capturedHeaders["Authorization"]).toBe("Bearer my-token");
  });

  test("throws BoltstoreError on API error response", async () => {
    mockFetch({ status: 400, body: { error: { code: "VALIDATION", message: "Invalid email" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).status).toBe(400);
      expect((err as BoltstoreError).code).toBe("VALIDATION");
      expect((err as BoltstoreError).message).toBe("Invalid email");
    }
  });

  test("throws BoltstoreError on non-JSON response", async () => {
    mockFetchError(500, "Internal Server Error", "text/html");
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("INVALID_RESPONSE");
    }
  });

  test("throws BoltstoreError on JSON parse failure", async () => {
    globalThis.fetch = async () => {
      return new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("PARSE_ERROR");
    }
  });

  test("retries on network error", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      throw new Error("fetch failed");
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test", undefined, 2);
    } catch {}
    expect(attempts).toBe(3);
  });

  test("throws NETWORK_ERROR when all retries exhausted", async () => {
    globalThis.fetch = async () => {
      throw new Error("fetch failed");
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test", undefined, 1);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("NETWORK_ERROR");
    }
  });

  test("does not retry on API errors (non-network)", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { code: "ERROR", message: "fail" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.request("GET", "/api/test", undefined, 2);
    } catch {}
    expect(attempts).toBe(1);
  });
});

describe("BoltstoreClient — token management", () => {
  test("setToken and getToken round-trip", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    client.setToken("abc");
    expect(client.getToken()).toBe("abc");
    client.setToken(undefined);
    expect(client.getToken()).toBeUndefined();
  });

  test("setRefreshToken and getRefreshToken round-trip", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    client.setRefreshToken("xyz");
    expect(client.getRefreshToken()).toBe("xyz");
  });
});
