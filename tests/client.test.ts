import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient, BoltstoreError } from "../src/client";

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

describe("BoltstoreClient — buildListPath", () => {
  test("builds path with sort and direction", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { sort: "name", direction: "asc" });
    expect(path).toContain("/api/dbs_app/collections/users/records");
    expect(path).toContain("sort=name");
    expect(path).toContain("direction=asc");
  });

  test("builds path with limit and offset", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { limit: 10, offset: 20 });
    expect(path).toContain("limit=10");
    expect(path).toContain("offset=20");
  });

  test("builds path with page and perPage", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { page: 2, perPage: 25 });
    expect(path).toContain("page=2");
    expect(path).toContain("per_page=25");
  });

  test("builds path with fields", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { fields: ["name", "email"] });
    expect(path).toContain("fields=name%2Cemail");
  });

  test("builds path with expand", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("posts", { expand: ["author", "category"] });
    expect(path).toContain("expand=author%2Ccategory");
  });

  test("builds path with filter", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", age: 30 } });
    expect(path).toContain("name=Alice");
    expect(path).toContain("age=30");
  });

  test("skips null and undefined filter values", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", deleted: null, archived: undefined } });
    expect(path).toContain("name=Alice");
    expect(path).not.toContain("deleted");
    expect(path).not.toContain("archived");
  });

  test("skips object filter values", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { filter: { name: "Alice", meta: { key: "val" } } });
    expect(path).toContain("name=Alice");
    expect(path).not.toContain("meta");
  });

  test("handles array filter values", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users", { filter: { status: ["active", "pending"] } });
    expect(path).toContain("status=active%2Cpending");
  });

  test("no query string when no options", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const path = client.buildListPath("users");
    expect(path).toBe("/api/dbs_app/collections/users/records");
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

describe("BoltstoreClient — query", () => {
  beforeAll(() => {
    mockFetch({ body: { data: [{ id: "1", title: "Result" }], meta: {} } });
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("query sends POST and returns results", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
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
