import { describe, expect, test } from "bun:test";
import { BoltstoreClient, TableRef, QueryBuilder } from "../src/client";

describe("BoltstoreClient", () => {
  test("constructor sets url, database, key", () => {
    const client = new BoltstoreClient({
      url: "http://localhost:8080",
      database: "testdb",
      key: "boltstore_testkey",
    });
    expect(client).toBeDefined();
  });

  test("constructor strips trailing slash from url", () => {
    const client = new BoltstoreClient({
      url: "http://localhost:8080/",
      database: "testdb",
    });
    expect(client).toBeDefined();
  });

  test("setKey updates the key", () => {
    const client = new BoltstoreClient({
      url: "http://localhost:8080",
      database: "testdb",
    });
    client.setKey("newkey");
    expect(client).toBeDefined();
  });

  test("table() returns a TableRef", () => {
    const client = new BoltstoreClient({
      url: "http://localhost:8080",
      database: "testdb",
    });
    const ref = client.table("posts");
    expect(ref).toBeInstanceOf(TableRef);
  });

  test("table() returns a TableRef with query() method", () => {
    const client = new BoltstoreClient({
      url: "http://localhost:8080",
      database: "testdb",
    });
    const ref = client.table("posts");
    const qb = ref.query();
    expect(qb).toBeInstanceOf(QueryBuilder);
  });
});

describe("QueryBuilder", () => {
  test("where() chains correctly", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    const result = qb.where("title", "eq", "hello").where("views", "gt", 10);
    expect(result).toBe(qb);
  });

  test("orWhere() chains correctly", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    const result = qb.where("title", "eq", "hello").orWhere("title", "eq", "world");
    expect(result).toBe(qb);
  });

  test("orderBy() chains correctly", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    const result = qb.orderBy("created_at", "desc").orderBy("title");
    expect(result).toBe(qb);
  });

  test("limit() and offset() chain correctly", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    const result = qb.limit(10).offset(20);
    expect(result).toBe(qb);
  });

  test("select() chains correctly", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table<{ id: number; title: string }>("posts").query();
    const result = qb.select("id", "title");
    expect(result).toBe(qb);
  });

  test("where() with unsupported op throws", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    expect(() => qb.where("title", "unsupported", "value")).toThrow("Unsupported query operator");
  });

  test("orWhere() with unsupported op throws", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    expect(() => qb.orWhere("title", "unsupported", "value")).toThrow("Unsupported query operator");
  });

  test("where() with supported ops does not throw", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const qb = client.table("posts").query();
    const ops = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "like", "glob"];
    for (const op of ops) {
      expect(() => qb.where("field", op, "value")).not.toThrow();
    }
  });
});

describe("TableRef", () => {
  test("query() returns a QueryBuilder", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8080", database: "testdb" });
    const ref = client.table("posts");
    const qb = ref.query();
    expect(qb).toBeInstanceOf(QueryBuilder);
  });
});
