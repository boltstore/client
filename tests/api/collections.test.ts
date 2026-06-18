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

describe("BoltstoreClient — collections", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("collections.list returns array", async () => {
    mockFetch({ body: { data: [{ name: "users", schema: [], recordCount: 0, createdAt: "", updatedAt: "" }] } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const list = await client.collections.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list[0].name).toBe("users");
  });

  test("collections.get returns single collection", async () => {
    mockFetch({ body: { data: { name: "posts", schema: [{ name: "title", type: "TEXT" }], recordCount: 5, createdAt: "", updatedAt: "" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", database: "app" });
    const col = await client.collections.get("posts");
    expect(col.name).toBe("posts");
    expect(col.schema).toHaveLength(1);
    expect(col.schema[0].name).toBe("title");
  });
});
