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

  test("createQuery().where().get() returns filtered records", async () => {
    mockFetch({ body: { data: [{ id: "rec_1", title: "A" }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const records = await client.collection("items").createQuery().where("title", "A").get();
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe("A");
  });

  test("createQuery().where().first() returns first match", async () => {
    mockFetch({ body: { data: [{ id: "rec_1", title: "Test" }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const record = await client.collection("items").createQuery().where("id", "rec_1").first();
    expect(record).not.toBeNull();
    expect(record!.id).toBe("rec_1");
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

  test("createQuery().count() returns number", async () => {
    mockFetch({ body: { data: [{ count: 42 }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const count = await client.collection("items").createQuery().count();
    expect(count).toBe(42);
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

  test("createQuery().paginate() returns paginated result", async () => {
    mockFetch({ body: { data: [{ id: "1" }], meta: { total: 1 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const result = await client.collection("items").createQuery().paginate(1, 10);
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(1);
  });

  test("subscribe returns an unsubscribe function", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const unsub = client.collection("items").subscribe(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
