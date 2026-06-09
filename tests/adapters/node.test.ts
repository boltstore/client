import { describe, it, expect } from "bun:test";
import { createNodeAdapter } from "../../src/adapters/node";

describe("Node Adapter", () => {
  it("should create a node adapter", () => {
    const adapter = createNodeAdapter();
    expect(adapter.name).toBe("node");
    expect(adapter.fetch).toBeDefined();
    expect(adapter.createWebSocket).toBeDefined();
    expect(adapter.createLocalDb).toBeDefined();
  });

  it("should create a local database", () => {
    const adapter = createNodeAdapter();
    const db = adapter.createLocalDb("test-db");
    expect(db).toBeDefined();
    expect(db.exec).toBeDefined();
    expect(db.query).toBeDefined();
    expect(db.run).toBeDefined();
    expect(db.close).toBeDefined();
    db.close();
  });

  it("should execute SQL via local db", () => {
    const adapter = createNodeAdapter();
    const db = adapter.createLocalDb("test-db");
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO test (name) VALUES (?)", ["test-row"]);
    // Note: bun:sqlite returns rows in a specific format
    expect(() => db.query("SELECT * FROM test")).not.toThrow();
    db.close();
  });
});
