import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient, BoltstoreError } from "../../src/client";

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

describe("BoltstoreClient — records", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("records.create sends POST with data", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Test", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.records.create("items", { title: "Test" });
    expect(record.id).toBe("rec_1");
  });

  test("records.list returns array", async () => {
    mockFetch({ body: { data: [{ id: "rec_1", title: "A" }, { id: "rec_2", title: "B" }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const records = await client.records.list("items");
    expect(records).toHaveLength(2);
  });

  test("records.list passes options to buildListPath", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    await client.records.list("items", { sort: "name", limit: 5 });
    expect(capturedUrl).toContain("sort=name");
    expect(capturedUrl).toContain("limit=5");
  });

  test("records.get returns single record", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Test", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.records.get("items", "rec_1");
    expect(record.id).toBe("rec_1");
    expect(record.title).toBe("Test");
  });

  test("records.update sends PATCH with data", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Updated", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.records.update("items", "rec_1", { title: "Updated" });
    expect(record.title).toBe("Updated");
  });

  test("records.delete sends DELETE", async () => {
    mockFetch({ body: { data: { deleted: true } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    await client.records.delete("items", "rec_1");
    // No throw = success
  });

  test("records.count returns number", async () => {
    mockFetch({ body: { data: { count: 42 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const count = await client.records.count("items");
    expect(count).toBe(42);
  });

  test("records.count with filter builds query params", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ data: { count: 5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const count = await client.records.count("items", { status: "active" });
    expect(count).toBe(5);
    expect(capturedUrl).toContain("status=active");
  });

  test("records.count throws on object filter values", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    try {
      await client.records.count("items", { status: { $eq: "active" } });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("INVALID_FILTER");
    }
  });

  test("records.distinct returns values", async () => {
    mockFetch({ body: { data: { field: "status", values: ["active", "inactive"] } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const values = await client.records.distinct("items", "status");
    expect(values).toEqual(["active", "inactive"]);
  });

  test("records.batch returns BatchResult", async () => {
    mockFetch({ body: { data: { created: 2, updated: 0, deleted: 0, errors: [] } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const result = await client.records.batch("items", [
      { action: "create", data: { title: "A" } },
      { action: "create", data: { title: "B" } },
    ]);
    expect(result.created).toBe(2);
  });

  test("records.paginate returns paginated result", async () => {
    mockFetch({ body: { data: [{ id: "1" }], meta: { page: 1, per_page: 10, total: 1, total_pages: 1 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const result = await client.records.paginate("items", { page: 1, perPage: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(10);
  });

  test("records.paginate passes sort, direction, filter params", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ data: [], meta: { page: 1, per_page: 10, total: 0, total_pages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    await client.records.paginate("items", { page: 1, sort: "name", direction: "desc", filter: { status: "active" } });
    expect(capturedUrl).toContain("sort=name");
    expect(capturedUrl).toContain("direction=desc");
    expect(capturedUrl).toContain("status=active");
  });

  test("records.paginate throws on object filter", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    try {
      await client.records.paginate("items", { page: 1, filter: { status: { $eq: "active" } } });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("INVALID_FILTER");
    }
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
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const all = await client.records.listAll("items", { perPage: 1 });
    expect(all).toHaveLength(3);
    expect(callCount).toBe(3);
  });

  test("records.listAll throws TOO_MANY_PAGES", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        data: [{ id: "rec_1" }],
        meta: { page: 1, per_page: 1, total: 9999, total_pages: 9999 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    try {
      await client.records.listAll("items", { perPage: 1 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("TOO_MANY_PAGES");
    }
  });
});
