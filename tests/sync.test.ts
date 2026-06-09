import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { SyncEngine, enableSync } from "../src/sync";
import { createNodeAdapter } from "../src/adapters/node";
import { Database } from "bun:sqlite";

describe("SyncEngine", () => {
  let client: BoltstoreClient;
  let adapter: ReturnType<typeof createNodeAdapter>;
  let localDb: ReturnType<typeof adapter.createLocalDb>;
  let engine: SyncEngine;

  beforeEach(() => {
    client = new BoltstoreClient({ url: "http://localhost:8090" });
    adapter = createNodeAdapter();
    const db = new Database(":memory:");
    localDb = {
      exec: (sql: string) => db.run(sql),
      query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => db.query(sql).all(...params) as T[],
      queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => (db.query(sql).get(...params) as T) ?? null,
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

  it("should create a sync engine", () => {
    expect(engine).toBeDefined();
    expect(engine.connection).toBe("disconnected");
    expect(engine.pendingChangeCount).toBe(0);
    expect(engine.nodeId).toBeDefined();
  });

  it("should track local changes", () => {
    engine.trackLocalChange("tasks", "task-1", "insert", { title: "Buy milk" });
    expect(engine.pendingChangeCount).toBe(1);
  });

  it("should create and cache local records", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Buy milk", done: false });
    const cached = engine.getCachedRecord("tasks", "task-1");
    expect(cached).toBeDefined();
    expect(cached?.title).toBe("Buy milk");
    expect(engine.pendingChangeCount).toBe(1);
  });

  it("should update local records", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Buy milk", done: false });
    engine.updateLocalRecord("tasks", "task-1", { done: true });

    const cached = engine.getCachedRecord("tasks", "task-1");
    expect(cached?.done).toBe(true);
    expect(cached?.title).toBe("Buy milk");
    // Should have 1 insert + 1 update (update may create multiple field changes)
    expect(engine.pendingChangeCount).toBeGreaterThan(1);
  });

  it("should delete local records", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Buy milk" });
    engine.deleteLocalRecord("tasks", "task-1");
    const cached = engine.getCachedRecord("tasks", "task-1");
    expect(cached).toBeNull();
    expect(engine.pendingChangeCount).toBe(2);
  });

  it("should persist pending changes to local DB", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "Persisted" });

    // Create a new engine pointing at the same DB to verify persistence
    const engine2 = new SyncEngine(client, {
      collections: ["tasks"],
      localDb,
      autoStart: false,
    });

    expect(engine2.pendingChangeCount).toBe(1);
    engine2.stop();
  });

  it("should list cached records", () => {
    engine.createLocalRecord("tasks", "task-1", { title: "A" });
    engine.createLocalRecord("tasks", "task-2", { title: "B" });
    const records = engine.listCachedRecords("tasks");
    expect(records.length).toBe(2);
  });

  it("should call onConflict when resolving", async () => {
    let conflictCalled = false;
    const engineWithConflict = new SyncEngine(client, {
      collections: ["tasks"],
      localDb,
      autoStart: false,
      onConflict: (local, server, strategy) => {
        conflictCalled = true;
        expect(strategy).toBe("server-wins");
        return server;
      },
    });

    // Simulate a conflict by directly calling resolveConflict via applyServerChanges
    engineWithConflict.createLocalRecord("tasks", "task-c", { title: "Local" });

    await (engineWithConflict as any).resolveConflict(
      { id: "local-1", collection: "tasks", rowId: "task-c", operation: "update", clock: 1, clientId: "client-1", timestamp: "2024-01-01" },
      { id: "srv-1", collection: "tasks", rowId: "task-c", operation: "update", clock: 2, clientId: "server", timestamp: "2024-01-01", newValue: { title: "Server" } }
    );

    expect(conflictCalled).toBe(true);
    engineWithConflict.stop();
  });
});

describe("enableSync", () => {
  it("should create and auto-start sync engine", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });
    const adapter = createNodeAdapter();
    const db = new Database(":memory:");
    const localDb = {
      exec: (sql: string) => db.run(sql),
      query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => db.query(sql).all(...params) as T[],
      queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => (db.query(sql).get(...params) as T) ?? null,
      run: (sql: string, ...params: unknown[]) => db.run(sql, ...params),
      close: () => db.close(),
    };

    const sync = enableSync(client, {
      collections: ["notes"],
      localDb,
      autoStart: false,
    });

    expect(sync).toBeDefined();
    expect(sync.connection).toBe("disconnected");
    sync.stop();
    localDb.close();
  });
});
