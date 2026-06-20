import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { SyncManager } from "../src/sync";

const ORIGINAL_FETCH = globalThis.fetch;

function mockJsonResponse(data: unknown, status = 200) {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ data }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("SyncManager — pull", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("pull fetches changes from server", async () => {
    const mockChanges = {
      changes: [
        { id: "chg_1", seq: 1, event: "create", collection: "posts", recordId: "rec_1", record: { id: "rec_1", title: "hello" }, previous: null, principalId: null, createdAt: "2024-01-01T00:00:00Z" },
      ],
      cursor: 1,
      hasMore: false,
    };
    mockJsonResponse(mockChanges);

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    const result = await sync.pull();

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].event).toBe("create");
    expect(result.changes[0].record.title).toBe("hello");
    expect(result.cursor).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  test("pull updates lastCursor", async () => {
    mockJsonResponse({ changes: [{ id: "chg_1", seq: 5, event: "create", collection: "posts", recordId: "rec_1", record: { id: "rec_1" }, previous: null, principalId: null, createdAt: "2024-01-01T00:00:00Z" }], cursor: 5, hasMore: false });

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    await sync.pull();
    expect(sync.lastCursor).toBe(5);

    // Second pull sends cursor=5
    let sentBody: unknown = null;
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { changes: [], cursor: null, hasMore: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    await sync.pull();
    expect((sentBody as Record<string, unknown>).cursor).toBe(5);
  });

  test("pull sends collection filter when specified", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { changes: [], cursor: null, hasMore: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    await sync.pull("users");
    expect((sentBody as Record<string, unknown>).collection).toBe("users");
  });

  test("pull sends correct API path", async () => {
    let sentUrl = "";
    globalThis.fetch = async (url: string, init: RequestInit) => {
      sentUrl = url as string;
      return new Response(JSON.stringify({ data: { changes: [], cursor: null, hasMore: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    await sync.pull();
    expect(sentUrl).toBe("http://localhost:8080/api/dbs_app/sync/pull");
  });

  test("pull sends auth token when set", async () => {
    let sentHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      sentHeaders = (init.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ data: { changes: [], cursor: null, hasMore: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", token: "my-token" });
    const sync = new SyncManager(client);
    await sync.pull();
    expect(sentHeaders["Authorization"]).toBe("Bearer my-token");
  });
});

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
});

describe("SyncManager — status", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("status returns current state", async () => {
    mockJsonResponse({ changes: [{ id: "chg_1", seq: 10, event: "create", collection: "x", recordId: "r1", record: { id: "r1" }, previous: null, principalId: null, createdAt: "2024-01-01T00:00:00Z" }], cursor: 10, hasMore: false });

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    const statusBefore = sync.status();
    expect(statusBefore.running).toBe(false);
    expect(statusBefore.lastCursor).toBeNull();

    await sync.pull();
    const statusAfter = sync.status();
    expect(statusAfter.lastCursor).toBe(10);
    expect(statusAfter.lastPullAt).toBeTruthy();
  });

  test("running flag reflects start/stop", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ data: { changes: [], cursor: null, hasMore: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const sync = new SyncManager(client);
    expect(sync.status().running).toBe(false);

    await sync.start();
    expect(sync.status().running).toBe(true);

    sync.stop();
    expect(sync.status().running).toBe(false);
  });
});

describe("SyncManager — dispose / cleanup", () => {
  test("sync property on BoltstoreClient is lazily created", () => {
    const client = new BoltstoreClient({
      baseUrl: "http://localhost:8080",
      databaseId: "dbs_app",
      sync: { clientId: "test-device" },
    });

    const sync = client.sync;
    expect(sync).toBeInstanceOf(SyncManager);
    expect(client.sync).toBe(sync);
  });

  test("sync module exported from client", async () => {
    const { SyncManager: ImportedSyncManager } = await import("../src/sync");
    expect(ImportedSyncManager).toBeDefined();
  });
});
