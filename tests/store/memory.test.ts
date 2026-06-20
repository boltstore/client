import { describe, it, expect } from "bun:test";
import { MemoryStore } from "../../src/store/memory";

describe("MemoryStore — CRUD", () => {
  it("insert and get records", async () => {
    const store = new MemoryStore();
    await store.insert("users", [{ id: "1", name: "Alice", age: 30 }]);
    const user = await store.get("users", "1");
    expect(user).not.toBeNull();
    expect(user!.name).toBe("Alice");
  });

  it("returns null for missing record", async () => {
    const store = new MemoryStore();
    expect(await store.get("users", "nonexistent")).toBeNull();
  });

  it("update a record", async () => {
    const store = new MemoryStore();
    await store.insert("users", [{ id: "1", name: "Alice", age: 30 }]);
    await store.update("users", "1", { age: 31 });
    const user = await store.get("users", "1");
    expect(user!.age).toBe(31);
    expect(user!.name).toBe("Alice");
  });

  it("delete a record", async () => {
    const store = new MemoryStore();
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.delete("users", "1");
    expect(await store.get("users", "1")).toBeNull();
  });
});

describe("MemoryStore — find / count / distinct", () => {
  it("find returns matching records", async () => {
    const store = new MemoryStore();
    await store.insert("users", [
      { id: "1", name: "Alice", age: 30 },
      { id: "2", name: "Bob", age: 25 },
      { id: "3", name: "Charlie", age: 30 },
    ]);
    const results = await store.find("users", { age: 30 });
    expect(results).toHaveLength(2);
  });

  it("find with sort and limit", async () => {
    const store = new MemoryStore();
    await store.insert("users", [
      { id: "1", name: "Alice", age: 30 },
      { id: "2", name: "Bob", age: 25 },
      { id: "3", name: "Charlie", age: 35 },
    ]);
    const results = await store.find("users", {}, { sort: "age", direction: "desc", limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("Charlie");
    expect(results[1].name).toBe("Alice");
  });

  it("count returns number of matching records", async () => {
    const store = new MemoryStore();
    await store.insert("users", [
      { id: "1", name: "Alice", age: 30 },
      { id: "2", name: "Bob", age: 25 },
    ]);
    expect(await store.count("users")).toBe(2);
    expect(await store.count("users", { age: 30 })).toBe(1);
  });

  it("distinct returns unique values", async () => {
    const store = new MemoryStore();
    await store.insert("users", [
      { id: "1", role: "admin" },
      { id: "2", role: "user" },
      { id: "3", role: "admin" },
    ]);
    const roles = await store.distinct("users", "role");
    expect(roles.sort()).toEqual(["admin", "user"]);
  });
});

describe("MemoryStore — query", () => {
  it("query with no filter returns all", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", name: "foo" },
      { id: "2", name: "bar" },
    ]);
    const result = await store.query({ collection: "items" });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it("query with $gt filter", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", price: 10 },
      { id: "2", price: 20 },
      { id: "3", price: 30 },
    ]);
    const result = await store.query({
      collection: "items",
      filter: { price: { $gt: 15 } },
    });
    expect(result.data).toHaveLength(2);
  });

  it("query with search", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", title: "Hello World" },
      { id: "2", title: "Goodbye" },
    ]);
    const result = await store.query({
      collection: "items",
      search: "hello",
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("1");
  });

  it("query with $and", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", type: "a", active: true },
      { id: "2", type: "a", active: false },
      { id: "3", type: "b", active: true },
    ]);
    const result = await store.query({
      collection: "items",
      filter: { $and: [{ type: "a" }, { active: true }] },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("1");
  });

  it("query with $or", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", type: "a" },
      { id: "2", type: "b" },
      { id: "3", type: "c" },
    ]);
    const result = await store.query({
      collection: "items",
      filter: { $or: [{ type: "a" }, { type: "b" }] },
    });
    expect(result.data).toHaveLength(2);
  });

  it("query with $not", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", active: true },
      { id: "2", active: false },
    ]);
    const result = await store.query({
      collection: "items",
      filter: { $not: { active: true } },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("2");
  });

  it("query with $contains", async () => {
    const store = new MemoryStore();
    await store.insert("items", [
      { id: "1", tag: "javascript" },
      { id: "2", tag: "typescript" },
      { id: "3", tag: "python" },
    ]);
    const result = await store.query({
      collection: "items",
      filter: { tag: { $contains: "script" } },
    });
    expect(result.data).toHaveLength(2);
  });
});

describe("MemoryStore — applyChanges", () => {
  it("applies create changes", async () => {
    const store = new MemoryStore();
    await store.applyChanges("users", [
      { event: "create", recordId: "1", record: { id: "1", name: "Alice" }, previous: null },
    ]);
    expect(await store.get("users", "1")).not.toBeNull();
  });

  it("applies update changes", async () => {
    const store = new MemoryStore();
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.applyChanges("users", [
      { event: "update", recordId: "1", record: { name: "Alicia" }, previous: { name: "Alice" } },
    ]);
    const user = await store.get("users", "1");
    expect(user!.name).toBe("Alicia");
  });

  it("applies delete changes", async () => {
    const store = new MemoryStore();
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.applyChanges("users", [
      { event: "delete", recordId: "1", record: { id: "1" }, previous: null },
    ]);
    expect(await store.get("users", "1")).toBeNull();
  });
});
