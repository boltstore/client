import { describe, expect, test } from "bun:test";
import { TypedCollectionImpl, type MinimalClient } from "../src/typed-collection";
import type { ApiResponse } from "../src/typed-collection";
import { ClientQueryBuilder } from "../src/query-builder";

interface Post {
  title: string;
  content: string;
}

function createMockClient(overrides?: Partial<MinimalClient>): MinimalClient {
  return {
    request: async <T>(_method: string, _path: string, _body?: unknown): Promise<ApiResponse<T>> => {
      return { data: undefined as unknown as T };
    },
    localStore: null,
    ...overrides,
  };
}

describe("TypedCollectionImpl", () => {
  test("create sends POST and returns record", async () => {
    const client = createMockClient({
      request: async (_method, _path, _body) => ({
        data: { id: "rec_1", title: "Hello", content: "World", created_at: "now", updated_at: "now" },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const record = await col.create({ title: "Hello", content: "World" });
    expect(record.id).toBe("rec_1");
    expect(record.title).toBe("Hello");
  });

  test("createQuery returns a ClientQueryBuilder", () => {
    const client = createMockClient();
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const qb = col.createQuery();
    expect(qb).toBeInstanceOf(ClientQueryBuilder);
  });

  test("createQuery().where().get() returns filtered records", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [
          { id: "rec_1", title: "A", content: "a", created_at: "now", updated_at: "now" },
        ],
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const records = await col.createQuery().where("title", "A").get();
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe("A");
  });

  test("createQuery().where().first() returns first match or null", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [
          { id: "rec_1", title: "Hello", content: "World", created_at: "now", updated_at: "now" },
        ],
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const record = await col.createQuery().where("id", "rec_1").first();
    expect(record).not.toBeNull();
    expect(record!.id).toBe("rec_1");
  });

  test("update sends PATCH and returns updated record", async () => {
    const client = createMockClient({
      request: async (_method, _path, _body) => ({
        data: { id: "rec_1", title: "Updated", content: "World", created_at: "now", updated_at: "now" },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const record = await col.update("rec_1", { title: "Updated" });
    expect(record.title).toBe("Updated");
  });

  test("delete sends DELETE", async () => {
    let capturedMethod = "";
    const client = createMockClient({
      request: async (method) => {
        capturedMethod = method;
        return { data: { deleted: true } };
      },
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    await col.delete("rec_1");
    expect(capturedMethod).toBe("DELETE");
  });

  test("createQuery().count() returns number", async () => {
    const client = createMockClient({
      request: async () => ({ data: [{ count: 7 }] }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const count = await col.createQuery().count();
    expect(count).toBe(7);
  });

  test("batch returns BatchResult", async () => {
    const client = createMockClient({
      request: async () => ({ data: { created: 2, updated: 0, deleted: 0 } }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const result = await col.batch([
      { action: "create", data: { title: "A", content: "a" } },
    ]);
    expect(result.created).toBe(2);
  });

  test("createQuery().paginate() returns paginated result", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [{ id: "rec_1", title: "A", content: "a", created_at: "now", updated_at: "now" }],
        meta: { total: 1 },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const result = await col.createQuery().paginate(1, 10);
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(10);
    expect(result.meta.total).toBe(1);
  });

  test("subscribe registers and unsubscribes callbacks", () => {
    const client = createMockClient();
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    let callCount = 0;
    const unsub = col.subscribe(() => { callCount++; });
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
