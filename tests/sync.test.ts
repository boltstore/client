import { describe, expect, test, afterAll } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { SyncManager, InMemoryStore } from "../src/sync";

const ORIGINAL_FETCH = globalThis.fetch;

describe("SyncManager — push", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("push sends operations to server", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { ok: true, results: [{ event: "create", collection: "posts", id: "rec_new", status: "created" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", token: "tok" });
    const sync = new SyncManager(client, { clientId: "device_1" });
    const result = await sync.push([{ event: "create", collection: "posts", data: { title: "new post" } }]);

    expect(result.ok).toBe(true);
    expect(result.results[0].status).toBe("created");
    const body = sentBody as Record<string, unknown>;
    expect((body.operations as unknown[])).toHaveLength(1);
    expect(body.clientId).toBe("device_1");
  });

  test("push sends correct path", async () => {
    let sentUrl = "";
    globalThis.fetch = async (url: string, init: RequestInit) => {
      sentUrl = url as string;
      return new Response(JSON.stringify({ data: { ok: true, results: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    await sync.push([{ event: "create", collection: "items", data: { x: 1 } }]);
    expect(sentUrl).toBe("http://localhost:8080/api/dbs_app/sync/push");
  });

  test("push returns result with errors", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ data: { ok: false, results: [{ event: "update", collection: "posts", id: "bad_id", status: "error", error: "Not found" }] } }), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    const result = await sync.push([{ event: "update", collection: "posts", id: "bad_id", data: { title: "x" } }]);

    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].error).toBe("Not found");
  });

  test("push queues operations on network error and returns queued status", async () => {
    globalThis.fetch = async () => { throw new Error("fetch failed"); };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    const result = await sync.push([{ event: "create", collection: "posts", data: { title: "offline" } }]);

    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe("queued");
    expect(sync.queueSize).toBe(1);
    expect(sync.isOnline).toBe(false);
  });

  test("successful push restores online status", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    expect(sync.isOnline).toBe(true);

    // Queue an operation via network error
    globalThis.fetch = async () => { throw new Error("fetch failed"); };
    await sync.push([{ event: "create", collection: "posts", data: { title: "queued" } }]);
    expect(sync.queueSize).toBe(1);
    expect(sync.isOnline).toBe(false);

    // Restore connectivity
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ data: { ok: true, results: [{ event: "create", collection: "posts", id: "r_ok", status: "created" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await sync.flushQueue();
    expect(sync.queueSize).toBe(0);
    expect(sync.isOnline).toBe(true);
  });

  test("custom store persists queue across SyncManager instances", async () => {
    const store = new InMemoryStore();
    globalThis.fetch = async () => { throw new Error("fetch failed"); };

    const client1 = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync1 = new SyncManager(client1, { store });
    await sync1.push([{ event: "create", collection: "posts", data: { title: "persist_test" } }]);
    expect(sync1.queueSize).toBe(1);

    const sync2 = new SyncManager(client1, { store });
    await sync2.setOnline(true);
    await sync2.flushQueue();
    expect(sync2.queueSize).toBe(1);
  });

  test("InMemoryStore get/set/remove/clear round-trips", async () => {
    const store = new InMemoryStore();
    expect(await store.get("key1")).toBeNull();
    await store.set("key1", "val1");
    expect(await store.get("key1")).toBe("val1");
    await store.set("key2", "val2");
    await store.remove("key1");
    expect(await store.get("key1")).toBeNull();
    expect(await store.get("key2")).toBe("val2");
    await store.clear();
    expect(await store.get("key2")).toBeNull();
  });

  test("onQueueError fires for operations that exhaust retries", async () => {
    let errorFired = false;
    let failedOps: unknown[] = [];

    globalThis.fetch = async () => { throw new Error("fetch failed"); };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client, {
      maxQueueRetries: 1,
      onQueueError: (err, ops) => {
        errorFired = true;
        failedOps = ops;
      },
    });

    await sync.push([{ event: "create", collection: "test", data: { x: 1 } }]);
    expect(sync.queueSize).toBe(1);

    // First flush: retries go from 0→1
    await sync.flushQueue();

    // Second flush: retries 1 >= 1, fires onQueueError
    await sync.flushQueue();
    expect(errorFired).toBe(true);
    expect(failedOps).toHaveLength(1);
  });
});
