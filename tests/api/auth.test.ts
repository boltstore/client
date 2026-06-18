import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { BoltstoreClient, BoltstoreError } from "../../src/client";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(response: { status?: number; body?: unknown; headers?: Record<string, string> }) {
  globalThis.fetch = async () => {
    const body = JSON.stringify(response.body ?? {});
    return new Response(body, {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json", ...response.headers },
    });
  };
}

describe("BoltstoreClient — auth", () => {
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("login stores token and refreshToken", async () => {
    mockFetch({ body: { data: { accessToken: "at_123", refreshToken: "rt_456", expiresIn: 900 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const tokens = await client.auth.login("user@test.com", "pass");
    expect(tokens.accessToken).toBe("at_123");
    expect(client.getToken()).toBe("at_123");
    expect(client.getRefreshToken()).toBe("rt_456");
  });

  test("register returns UserProfile", async () => {
    mockFetch({ body: { data: { id: "usr_1", email: "new@test.com", role: "user", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const profile = await client.auth.register("new@test.com", "pass");
    expect(profile.id).toBe("usr_1");
    expect(profile.email).toBe("new@test.com");
    expect(profile.role).toBe("user");
  });

  test("logout clears token and refreshToken", async () => {
    mockFetch({ body: { data: {} } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", token: "tok", refreshToken: "rt" });
    await client.auth.logout();
    expect(client.getToken()).toBeUndefined();
    expect(client.getRefreshToken()).toBeUndefined();
  });

  test("refresh uses stored refreshToken", async () => {
    mockFetch({ body: { data: { accessToken: "at_123", refreshToken: "rt_456", expiresIn: 900 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", refreshToken: "rt_456" });
    const tokens = await client.auth.refresh();
    expect(tokens.accessToken).toBe("at_123");
    expect(client.getToken()).toBe("at_123");
  });

  test("refresh uses provided refreshToken over stored one", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { accessToken: "at_new", refreshToken: "rt_new", expiresIn: 900 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", refreshToken: "rt_stored" });
    await client.auth.refresh("rt_explicit");
    expect((sentBody as Record<string, unknown>).refreshToken).toBe("rt_explicit");
  });

  test("refresh throws when no refreshToken available", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    try {
      await client.auth.refresh();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as BoltstoreError).code).toBe("MISSING_REFRESH_TOKEN");
    }
  });

  test("me returns UserProfile", async () => {
    mockFetch({ body: { data: { id: "usr_1", email: "me@test.com", role: "user", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", token: "tok" });
    const profile = await client.auth.me();
    expect(profile.id).toBe("usr_1");
    expect(profile.email).toBe("me@test.com");
  });

  test("updateProfile returns updated UserProfile", async () => {
    mockFetch({ body: { data: { id: "usr_1", email: "updated@test.com", role: "user", created_at: "now", updated_at: "now" } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app", token: "tok" });
    const profile = await client.auth.updateProfile({ email: "updated@test.com" });
    expect(profile.email).toBe("updated@test.com");
  });

  test("oauthUrl returns URL string", async () => {
    mockFetch({ body: { data: { url: "https://accounts.google.com/o/oauth2/auth?..." } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const url = await client.auth.oauthUrl("google", "http://localhost:3000/callback");
    expect(url).toContain("accounts.google.com");
  });

  test("oauthExchange returns TokenPair and stores tokens", async () => {
    mockFetch({ body: { data: { accessToken: "at_oauth", refreshToken: "rt_oauth", expiresIn: 900 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    const tokens = await client.auth.oauthExchange("google", "auth_code", "http://localhost:3000/callback");
    expect(tokens.accessToken).toBe("at_oauth");
    expect(client.getToken()).toBe("at_oauth");
    expect(client.getRefreshToken()).toBe("rt_oauth");
  });

  test("autoRefresh returns null when token is not close to expiry", async () => {
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    const token = "header." + btoa(JSON.stringify({ exp: farFuture })) + ".sig";
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token, refreshToken: "rt" });
    const result = await client.auth.autoRefresh(60);
    expect(result).toBeNull();
  });

  test("autoRefresh returns null when no token set", async () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    const result = await client.auth.autoRefresh();
    expect(result).toBeNull();
  });

  test("autoRefresh returns null when payload has no exp", async () => {
    const token = "header." + btoa(JSON.stringify({ sub: "usr_1" })) + ".sig";
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token, refreshToken: "rt" });
    const result = await client.auth.autoRefresh();
    expect(result).toBeNull();
  });

  test("autoRefresh refreshes when token is expiring", async () => {
    const nearExpiry = Math.floor(Date.now() / 1000) + 10;
    const token = "header." + btoa(JSON.stringify({ exp: nearExpiry })) + ".sig";
    mockFetch({ body: { data: { accessToken: "at_refreshed", refreshToken: "rt_refreshed", expiresIn: 900 } } });
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token, refreshToken: "rt" });
    const result = await client.auth.autoRefresh(60);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("at_refreshed");
    expect(client.getToken()).toBe("at_refreshed");
  });
});
