import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient, BoltstoreError } from "../src/client";
import { decodeJwtPayload } from "../src/jwt";

// ---------------------------------------------------------------------------
// BoltstoreError
// ---------------------------------------------------------------------------

describe("BoltstoreError", () => {
  test("creates error with status, code, message", () => {
    const err = new BoltstoreError(404, "NOT_FOUND", "User not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("User not found");
    expect(err.name).toBe("BoltstoreError");
  });

  test("creates error with details", () => {
    const err = new BoltstoreError(400, "VALIDATION", "Invalid input", { field: "email" });
    expect(err.details).toEqual({ field: "email" });
  });
});

// ---------------------------------------------------------------------------
// decodeJwtPayload
// ---------------------------------------------------------------------------

describe("decodeJwtPayload", () => {
  test("decodes a valid JWT payload", () => {
    const token = "header." + btoa(JSON.stringify({ sub: "usr_123", exp: 9999999999, role: "user" })) + ".sig";
    const payload = decodeJwtPayload(token);
    expect(payload?.sub).toBe("usr_123");
    expect(payload?.exp).toBe(9999999999);
    expect(payload?.role).toBe("user");
  });

  test("returns null for malformed token", () => {
    expect(decodeJwtPayload("invalid")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(decodeJwtPayload("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BoltstoreClient — unit tests with mocked fetch
// ---------------------------------------------------------------------------

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
  test("includes database in path when set", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "myapp" });
    expect(client.dbPath("/collections")).toBe("/api/myapp/collections");
  });

  test("omits database in path when not set", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    expect(client.dbPath("/collections")).toBe("/api/collections");
  });

  test("strips trailing slash from baseUrl", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080/" });
    expect(client.dbPath("/health")).toBe("/api/health");
  });
});

describe("BoltstoreClient — buildListPath", () => {
  test("builds path with sort and direction", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { sort: "name", direction: "asc" });
    expect(path).toContain("/api/app/collections/users/records");
    expect(path).toContain("sort=name");
    expect(path).toContain("direction=asc");
  });

  test("builds path with limit and offset", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { limit: 10, offset: 20 });
    expect(path).toContain("limit=10");
    expect(path).toContain("offset=20");
  });

  test("builds path with page and perPage", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { page: 2, perPage: 25 });
    expect(path).toContain("page=2");
    expect(path).toContain("per_page=25");
  });

  test("builds path with fields", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { fields: ["name", "email"] });
    expect(path).toContain("fields=name%2Cemail");
  });

  test("builds path with expand", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("posts", { expand: ["author", "category"] });
    expect(path).toContain("expand=author%2Ccategory");
  });

  test("builds path with filter", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", age: 30 } });
    expect(path).toContain("name=Alice");
    expect(path).toContain("age=30");
  });

  test("skips null and undefined filter values", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", deleted: null, archived: undefined } });
    expect(path).toContain("name=Alice");
    expect(path).not.toContain("deleted");
    expect(path).not.toContain("archived");
  });

  test("skips object filter values", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", meta: { key: "val" } } });
    expect(path).toContain("name=Alice");
    expect(path).not.toContain("meta");
  });

  test("no query string when no options", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const path = client.buildListPath("users");
    expect(path).toBe("/api/app/collections/users/records");
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
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe("BoltstoreClient — auth", () => {
  beforeAll(() => {
    mockFetch({ body: { data: { accessToken: "at_123", refreshToken: "rt_456", expiresIn: 900 } } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("login stores token and refreshToken", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const tokens = await client.auth.login("user@test.com", "pass");
    expect(tokens.accessToken).toBe("at_123");
    expect(client.getToken()).toBe("at_123");
    expect(client.getRefreshToken()).toBe("rt_456");
  });

  test("logout clears token and refreshToken", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app", token: "tok", refreshToken: "rt" });
    await client.auth.logout();
    expect(client.getToken()).toBeUndefined();
    expect(client.getRefreshToken()).toBeUndefined();
  });

  test("refresh uses stored refreshToken", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app", refreshToken: "rt_456" });
    const tokens = await client.auth.refresh();
    expect(tokens.accessToken).toBe("at_123");
    expect(client.getToken()).toBe("at_123");
  });

  test("refresh throws when no refreshToken available", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.auth.refresh();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("MISSING_REFRESH_TOKEN");
    }
  });

  test("autoRefresh returns null when token is not close to expiry", async () => {
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    const token = "header." + btoa(JSON.stringify({ exp: farFuture })) + ".sig";
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token, refreshToken: "rt" });
    const result = await client.auth.autoRefresh(60);
    expect(result).toBeNull();
  });

  test("autoRefresh returns null when no token set", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    const result = await client.auth.autoRefresh();
    expect(result).toBeNull();
  });
});

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

describe("BoltstoreClient — collections", () => {
  beforeAll(() => {
    mockFetch({ body: { data: [{ name: "users", schema: [], recordCount: 0, createdAt: "", updatedAt: "" }] } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("collections.list returns array", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const list = await client.collections.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list[0].name).toBe("users");
  });
});

describe("BoltstoreClient — records", () => {
  beforeAll(() => {
    mockFetch({ body: { data: { id: "rec_1", title: "Test", created_at: "now", updated_at: "now" } } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("records.create sends POST with data", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const record = await client.records.create("items", { title: "Test" });
    expect(record.id).toBe("rec_1");
  });

  test("records.count throws on object filter values", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    try {
      await client.records.count("items", { status: { $eq: "active" } });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("INVALID_FILTER");
    }
  });

  test("records.paginate returns paginated result", async () => {
    mockFetch({ body: { data: [{ id: "1" }], meta: { page: 1, per_page: 10, total: 1, total_pages: 1 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const result = await client.records.paginate("items", { page: 1, perPage: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(10);
  });

  test("records.listAll auto-paginates", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({
        data: [{ id: `rec_${callCount}` }],
        meta: { page: callCount, per_page: 1, total: 3, total_pages: 3 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const all = await client.records.listAll("items", { perPage: 1 });
    expect(all).toHaveLength(3);
    expect(callCount).toBe(3);
  });
});

describe("BoltstoreClient — query", () => {
  beforeAll(() => {
    mockFetch({ body: { data: [{ id: "1", title: "Result" }], meta: {} } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("query sends POST and returns results", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const result = await client.query({ collection: "items", filter: { title: { $eq: "Test" } } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe("Result");
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
