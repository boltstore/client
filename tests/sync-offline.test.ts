import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { SyncEngine } from "../src/sync";
import { Database } from "bun:sqlite";

describe("SyncEngine offline scenarios", () => {
  let client: BoltstoreClient;
  let localDb: {
    exec: (sql: string) => void;
    query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => T[];
    queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => T | null;
    run: (sql: string, ...params: unknown[]) => void;
    close: () => void;
  };
  let engine: SyncEngine;

  beforeEach(() => {
    client = new BoltstoreClient({ url: "http://localhost:8090" });
    const db = new Database(":memory:");
    localDb = {
      exec: (sql: string) => db.run(sql),
      query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
        db.query(sql).all(...params) as T[],
      queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
        (db.query(sql).get(...params) as T) ?? null,
      run: (sql: string, ...params: unknown[]) => db.run(sql, ...params),
      close: () => db.close(),
    };
    engine = new SyncEngine(client, {
      collections: ["tasks"],
      localDb,
      autoStart: false,
    });
  });

  afterEach(() => {
    engine.stop();
    localDb.close();
  });

  it("should queue changes while offline", () => {
    // Simulate offline: create records without sync connection
    engine.createLocalRecord("tasks", "task-1", { title: "Offline Task 1" });
    engine.createLocalRecord("tasks", "task-2", { title: "Offline Task 2" });

    expect(engine.pendingChangeCount).toBe(2);
    expect(engine.connection).toBe("disconnected");
  });

  it("should persist queued changes across engine restarts", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Survive Restart" });
    expect(engine.pendingChangeCount).toBe(1);

    // Simulate engine restart with same DB
    const engine2 = new SyncEngine(client, {
      collections: ["tasks"],
      localDb,
      autoStart: false,
    });

    expect(engine2.pendingChangeCount).toBe(1);
    expect(engine2.getCachedRecord("tasks", "task-1")?.title).toBe("Survive Restart");
    engine2.stop();
  });

  it("should handle updates to records created while offline", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Original", done: false });
    engine.updateLocalRecord("tasks", "task-1", { done: true });

    const cached = engine.getCachedRecord("tasks", "task-1");
    expect(cached?.title).toBe("Original");
    expect(cached?.done).toBe(true);
    expect(engine.pendingChangeCount).toBeGreaterThan(1);
  });

  it("should remove deleted records from cache", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "To Delete" });
    engine.deleteLocalRecord("tasks", "task-1");

    expect(engine.getCachedRecord("tasks", "task-1")).toBeNull();
    expect(engine.pendingChangeCount).toBe(2); // insert + delete
  });

  it("should track per-field updates separately", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "A", priority: 1 });
    engine.updateLocalRecord("tasks", "task-1", { title: "B", priority: 2 });

    // Two field changes should be tracked as separate entries for the update
    const pending = engine.pendingChangeCount;
    expect(pending).toBeGreaterThanOrEqual(2); // 1 insert + at least 1 update
  });

  it("should maintain version vector across restarts", () => {
    // Simulate receiving server changes
    (engine as any).applyServerChanges({
      changes: [],
      serverClock: 42,
      hasMore: false,
    });

    // Restart engine
    const engine2 = new SyncEngine(client, {
      collections: ["tasks"],
      localDb,
      autoStart: false,
    });

    // Version vector should persist
    const vv = (engine2 as any).state.versionVector as Record<string, number>;
    expect(vv["server"]).toBe(42);
    engine2.stop();
  });
});
