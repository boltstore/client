import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, readdirSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { NodeFileStore } from "../../src/store/node-file";

const TEST_DIR = ".boltstore_test";
const TEST_DIR_2 = ".boltstore_test_2";

describe("NodeFileStore — CRUD", () => {
  let store: NodeFileStore;

  beforeEach(async () => {
    store = new NodeFileStore(TEST_DIR);
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        unlinkSync(join(TEST_DIR, f));
      }
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("insert and get records", async () => {
    await store.insert("users", [{ id: "1", name: "Alice", age: 30 }]);
    const user = await store.get("users", "1");
    expect(user).not.toBeNull();
    expect(user!.name).toBe("Alice");
    expect(user!.age).toBe(30);

    // Verify file was written to disk
    const filePath = join(TEST_DIR, "users.json");
    expect(existsSync(filePath)).toBe(true);
    const { readFileSync } = await import("fs") as any;
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content["1"].name).toBe("Alice");
  });

  it("returns null for missing record", async () => {
    expect(await store.get("users", "nonexistent")).toBeNull();
  });

  it("update a record", async () => {
    await store.insert("users", [{ id: "1", name: "Alice", age: 30 }]);
    await store.update("users", "1", { age: 31 });
    const user = await store.get("users", "1");
    expect(user!.age).toBe(31);
    expect(user!.name).toBe("Alice");
  });

  it("delete a record", async () => {
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.delete("users", "1");
    expect(await store.get("users", "1")).toBeNull();
  });
});

describe("NodeFileStore — persistence across restarts", () => {
  it("survives store close and reopen", async () => {
    const store1 = new NodeFileStore(TEST_DIR_2);
    await store1.insert("items", [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);
    await store1.close();

    const store2 = new NodeFileStore(TEST_DIR_2);
    const results = await store2.find("items");
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === "a")!.value).toBe(1);
    expect(results.find((r) => r.id === "b")!.value).toBe(2);
    await store2.close();

    if (existsSync(TEST_DIR_2)) {
      for (const f of readdirSync(TEST_DIR_2)) {
        unlinkSync(join(TEST_DIR_2, f));
      }
      rmSync(TEST_DIR_2, { recursive: true, force: true });
    }
  });
});

describe("NodeFileStore — find / count / distinct", () => {
  let store: NodeFileStore;

  beforeEach(async () => {
    store = new NodeFileStore(TEST_DIR);
    await store.insert("users", [
      { id: "1", name: "Alice", age: 30 },
      { id: "2", name: "Bob", age: 25 },
      { id: "3", name: "Charlie", age: 30 },
    ]);
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        unlinkSync(join(TEST_DIR, f));
      }
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("find returns matching records", async () => {
    const results = await store.find("users", { age: 30 });
    expect(results).toHaveLength(2);
  });

  it("find with sort and limit", async () => {
    const results = await store.find("users", {}, { sort: "age", direction: "desc", limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("Alice");
    expect(results[1].name).toBe("Charlie");
  });

  it("count returns number of matching records", async () => {
    expect(await store.count("users")).toBe(3);
    expect(await store.count("users", { age: 30 })).toBe(2);
  });

  it("distinct returns unique values", async () => {
    const ages = await store.distinct("users", "age");
    expect(ages.sort()).toEqual([25, 30]);
  });
});

describe("NodeFileStore — query", () => {
  let store: NodeFileStore;

  beforeEach(async () => {
    store = new NodeFileStore(TEST_DIR);
    await store.insert("items", [
      { id: "1", price: 10, type: "a", active: true, tag: "javascript" },
      { id: "2", price: 20, type: "a", active: false, tag: "typescript" },
      { id: "3", price: 30, type: "b", active: true, tag: "python" },
    ]);
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        unlinkSync(join(TEST_DIR, f));
      }
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("query with no filter returns all", async () => {
    const result = await store.query({ collection: "items" });
    expect(result.data).toHaveLength(3);
    expect(result.meta.total).toBe(3);
  });

  it("query with $gt filter", async () => {
    const result = await store.query({ collection: "items", filter: { price: { $gt: 15 } } });
    expect(result.data).toHaveLength(2);
  });

  it("query with $and", async () => {
    const result = await store.query({ collection: "items", filter: { $and: [{ type: "a" }, { active: true }] } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("1");
  });

  it("query with $or", async () => {
    const result = await store.query({ collection: "items", filter: { $or: [{ type: "a" }, { type: "b" }] } });
    expect(result.data).toHaveLength(3);
  });

  it("query with $not", async () => {
    const result = await store.query({ collection: "items", filter: { $not: { active: true } } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("2");
  });

  it("query with $contains", async () => {
    const result = await store.query({ collection: "items", filter: { tag: { $contains: "script" } } });
    expect(result.data).toHaveLength(2);
  });
});

describe("NodeFileStore — applyChanges", () => {
  let store: NodeFileStore;

  beforeEach(async () => {
    store = new NodeFileStore(TEST_DIR);
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        unlinkSync(join(TEST_DIR, f));
      }
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("applies create changes", async () => {
    await store.applyChanges("users", [
      { event: "create", recordId: "1", record: { id: "1", name: "Alice" }, previous: null },
    ]);
    expect(await store.get("users", "1")).not.toBeNull();
  });

  it("applies update changes", async () => {
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.applyChanges("users", [
      { event: "update", recordId: "1", record: { name: "Alicia" }, previous: { name: "Alice" } },
    ]);
    const user = await store.get("users", "1");
    expect(user!.name).toBe("Alicia");
  });

  it("applies delete changes", async () => {
    await store.insert("users", [{ id: "1", name: "Alice" }]);
    await store.applyChanges("users", [
      { event: "delete", recordId: "1", record: { id: "1" }, previous: null },
    ]);
    expect(await store.get("users", "1")).toBeNull();
  });
});
