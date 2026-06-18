import { describe, expect, test } from "bun:test";
import { TypedCollectionImpl, type MinimalClient } from "../src/typed-collection";
import type { ApiResponse } from "../src/typed-collection";
import { BoltstoreError } from "../src/errors";

interface Post {
  title: string;
  content: string;
}

function createMockClient(overrides?: Partial<MinimalClient>): MinimalClient {
  return {
    request: async <T>(_method: string, _path: string, _body?: unknown): Promise<ApiResponse<T>> => {
      return { data: undefined as unknown as T };
    },
    buildListPath: (_collection: string, _options?: unknown): string => {
      return `/api/db/collections/${_collection}/records`;
    },
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

  test("list returns array", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [
          { id: "rec_1", title: "A", content: "a", created_at: "now", updated_at: "now" },
          { id: "rec_2", title: "B", content: "b", created_at: "now", updated_at: "now" },
        ],
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const records = await col.list();
    expect(records).toHaveLength(2);
  });

  test("list passes options to buildListPath", async () => {
    let capturedOptions: unknown = null;
    const client = createMockClient({
      buildListPath: (collection, options) => {
        capturedOptions = options;
        return `/api/db/collections/${collection}/records`;
      },
      request: async () => ({ data: [] }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    await col.list({ sort: "title", limit: 10 });
    expect(capturedOptions).toEqual({ sort: "title", limit: 10 });
  });

  test("get returns single record", async () => {
    const client = createMockClient({
      request: async () => ({
        data: { id: "rec_1", title: "Hello", content: "World", created_at: "now", updated_at: "now" },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const record = await col.get("rec_1");
    expect(record.id).toBe("rec_1");
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

  test("count returns number", async () => {
    const client = createMockClient({
      request: async () => ({ data: { count: 7 } }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const count = await col.count();
    expect(count).toBe(7);
  });

  test("count with filter builds query params", async () => {
    let capturedPath = "";
    const client = createMockClient({
      request: async (_method, path) => {
        capturedPath = path as string;
        return { data: { count: 3 } };
      },
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const count = await col.count({ title: "Hello" });
    expect(count).toBe(3);
    expect(capturedPath).toContain("title=Hello");
  });

  test("count throws on object filter values", async () => {
    const client = createMockClient();
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    try {
      await col.count({ title: { $eq: "Hello" } as unknown as string });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("INVALID_FILTER");
    }
  });

  test("distinct returns values", async () => {
    const client = createMockClient({
      request: async () => ({ data: { field: "title", values: ["A", "B", "C"] } }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const values = await col.distinct("title");
    expect(values).toEqual(["A", "B", "C"]);
  });

  test("batch returns BatchResult", async () => {
    const client = createMockClient({
      request: async () => ({ data: { created: 2, updated: 0, deleted: 0, errors: [] } }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const result = await col.batch([
      { action: "create", data: { title: "A", content: "a" } },
    ]);
    expect(result.created).toBe(2);
  });

  test("paginate returns paginated result", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [{ id: "rec_1", title: "A", content: "a", created_at: "now", updated_at: "now" }],
        meta: { page: 1, per_page: 10, total: 1, total_pages: 1 },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const result = await col.paginate({ page: 1, perPage: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.per_page).toBe(10);
  });

  test("paginate passes sort, direction, filter params", async () => {
    let capturedPath = "";
    const client = createMockClient({
      request: async (_method, path) => {
        capturedPath = path as string;
        return { data: [], meta: { page: 1, per_page: 10, total: 0, total_pages: 0 } };
      },
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    await col.paginate({ page: 1, sort: "title", direction: "desc", filter: { title: "Hello" } });
    expect(capturedPath).toContain("sort=title");
    expect(capturedPath).toContain("direction=desc");
    expect(capturedPath).toContain("title=Hello");
  });

  test("paginate throws on object filter", async () => {
    const client = createMockClient();
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    try {
      await col.paginate({ page: 1, filter: { title: { $eq: "Hello" } as unknown as string } });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("INVALID_FILTER");
    }
  });

  test("listAll auto-paginates", async () => {
    let callCount = 0;
    const client = createMockClient({
      request: async () => {
        callCount++;
        return {
          data: [{ id: `rec_${callCount}`, title: "A", content: "a", created_at: "now", updated_at: "now" }],
          meta: { page: callCount, per_page: 1, total: 3, total_pages: 3 },
        };
      },
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    const all = await col.listAll({ perPage: 1 });
    expect(all).toHaveLength(3);
    expect(callCount).toBe(3);
  });

  test("listAll throws TOO_MANY_PAGES", async () => {
    const client = createMockClient({
      request: async () => ({
        data: [{ id: "rec_1", title: "A", content: "a", created_at: "now", updated_at: "now" }],
        meta: { page: 1, per_page: 1, total: 9999, total_pages: 9999 },
      }),
    });
    const col = new TypedCollectionImpl<Post>(client, "posts", (p) => `/api/db${p}`);
    try {
      await col.listAll({ perPage: 1 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BoltstoreError);
      expect((err as BoltstoreError).code).toBe("TOO_MANY_PAGES");
    }
  });
});
