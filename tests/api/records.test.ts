import { describe, expect, test, afterAll } from "bun:test";
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

describe("TypedCollection — CRUD via client.collection()", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("create sends POST with data", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Test", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.collection("items").create({ title: "Test" });
    expect(record.id).toBe("rec_1");
  });

  test("list returns array", async () => {
    mockFetch({ body: { data: [{ id: "rec_1", title: "A" }, { id: "rec_2", title: "B" }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const records = await client.collection("items").list();
    expect(records).toHaveLength(2);
  });

  test("list passes options through buildListPath", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    await client.collection("items").list({ sort: "name", limit: 5 });
    expect(capturedUrl).toContain("sort=name");
    expect(capturedUrl).toContain("limit=5");
  });

  test("get returns single record", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Test", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.collection("items").get("rec_1");
    expect(record.id).toBe("rec_1");
    expect(record.title).toBe("Test");
  });

  test("update sends PATCH with data", async () => {
    mockFetch({ body: { data: { id: "rec_1", title: "Updated", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.collection("items").update("rec_1", { title: "Updated" });
    expect(record.title).toBe("Updated");
  });

  test("delete sends DELETE", async () => {
    mockFetch({ body: { data: { deleted: true } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    await client.collection("items").delete("rec_1");
  });

  test("count returns number", async () => {
    mockFetch({ body: { data: { count: 42 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const count = await client.collection("items").count();
    expect(count).toBe(42);
  });

  test("distinct returns values", async () => {
    mockFetch({ body: { data: { field: "status", values: ["active", "inactive"] } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const values = await client.collection("items").distinct("status");
    expect(values).toEqual(["active", "inactive"]);
  });

  test("batch returns BatchResult", async () => {
    mockFetch({ body: { data: { created: 2, updated: 0, deleted: 0 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const result = await client.collection("items").batch([
      { action: "create", data: { title: "A" } },
      { action: "create", data: { title: "B" } },
    ]);
    expect(result.created).toBe(2);
  });

  test("paginate returns paginated result", async () => {
    mockFetch({ body: { data: [{ id: "1" }], meta: { page: 1, per_page: 10, total: 1, total_pages: 1 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const result = await client.collection("items").paginate({ page: 1, perPage: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
  });

  test("subscribe returns an unsubscribe function", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const unsub = client.collection("items").subscribe(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
