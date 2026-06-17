/**
 * Integration tests for the @boltstore/client SDK.
 *
 * Starts a live Boltstore server on a random port, creates a test database
 * and collection, and exercises the SDK end-to-end.
 *
 * @module tests/client
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { DatabaseManager } from "../../boltstore/src/db/manager";
import { createServer } from "../../boltstore/src/server";
import { createAdminUserAndToken, testAuthConfig } from "../../boltstore/tests/helpers/auth";
import { BoltstoreClient } from "../src/client";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DATA_DIR = "/tmp/boltstore_test_client_sdk";
let server: ReturnType<typeof Bun.serve>;
let manager: DatabaseManager;
let baseUrl: string;
let adminToken: string;

function cleanup() {
  try { if (manager) manager.close(); } catch {}
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  cleanup();
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  manager = new DatabaseManager({ dataDir: TEST_DATA_DIR });
  const app = "sdktest";
  manager.createDatabase(app);
  const pool = manager.get(app);

  const authConfig = testAuthConfig();
  const { token } = await createAdminUserAndToken(pool);
  adminToken = token;

  server = createServer({
    port: 0,
    manager,
    auth: authConfig,
    rateLimit: { public: 1000, auth: 1000, admin: 1000, windowSeconds: 60 },
  });

  baseUrl = `http://localhost:${server.port}`;

  // Create a collection via the admin API so the SDK can use it.
  const resp = await fetch(`${baseUrl}/api/admin/${app}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: "items", columns: [{ name: "name", type: "TEXT" }, { name: "value", type: "INTEGER" }] }),
  });
  expect(resp.status).toBe(201);
});

afterAll(() => {
  server.stop();
  cleanup();
});

describe("SDK health", () => {
  test("client.health.check() returns status ok", async () => {
    const client = new BoltstoreClient({ baseUrl });
    const health = await client.health.check();
    expect(health.status).toBe("ok");
    expect(health.version).toBeTruthy();
    expect(health.timestamp).toBeTruthy();
  });
});

describe("SDK collections", () => {
  test("client.collections.list() returns collections", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    const collections = await client.collections.list();
    expect(collections.length).toBeGreaterThanOrEqual(1);
    expect(collections.map((c) => c.name)).toContain("items");
  });

  test("client.collections.get() returns schema", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    const info = await client.collections.get("items");
    expect(info.name).toBe("items");
    expect(info.schema).toHaveLength(2);
  });
});

describe("SDK records", () => {
  test("records.create(), .get(), .update(), .delete() round-trip", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    const created = await client.records.create("items", { name: "Alpha", value: 1 });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Alpha");

    const fetched = await client.records.get("items", created.id);
    expect(fetched.id).toBe(created.id);

    const updated = await client.records.update("items", created.id, { name: "Alpha Updated" });
    expect(updated.name).toBe("Alpha Updated");

    await client.records.delete("items", created.id);
    try {
      await client.records.get("items", created.id);
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      expect((err as { status: number }).status).toBe(404);
    }
  });

  test("records.list() and .count()", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    await client.records.create("items", { name: "Beta", value: 2 });
    await client.records.create("items", { name: "Gamma", value: 3 });

    const list = await client.records.list("items");
    expect(list.length).toBeGreaterThanOrEqual(2);

    const count = await client.records.count("items");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("records.paginate() returns metadata", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    const page = await client.records.paginate("items", { page: 1, perPage: 5 });
    expect(page.data).toBeDefined();
    expect(page.meta.page).toBe(1);
    expect(page.meta.per_page).toBe(5);
  });

  test("typed collection builder", async () => {
    type Item = { name: string; value: number };
    const client = new BoltstoreClient({ baseUrl, database: "sdktest", token: adminToken });
    const items = client.collection<Item>("items");
    const created = await items.create({ name: "Typed", value: 42 });
    expect(created.name).toBe("Typed");
    expect(created.value).toBe(42);
  });
});

describe("SDK auth", () => {
  test("client.auth.register() and .login() round-trip", async () => {
    const client = new BoltstoreClient({ baseUrl, database: "sdktest" });
    const profile = await client.auth.register("sdkuser@example.com", "password123");
    expect(profile.email).toBe("sdkuser@example.com");

    const tokens = await client.auth.login("sdkuser@example.com", "password123");
    expect(tokens.accessToken).toBeTruthy();
    expect(client.getToken()).toBe(tokens.accessToken);

    const me = await client.auth.me();
    expect(me.email).toBe("sdkuser@example.com");

    await client.auth.logout();
    expect(client.getToken()).toBeUndefined();
  });
});
