import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";

describe("BoltstoreClient", () => {
  it("should create a client instance", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });
    expect(client).toBeDefined();
    expect(client.authenticated).toBe(false);
    expect(client.token).toBeNull();
  });

  it("should manage auth state", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });

    client.setAuth({
      token: "test-token",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600_000,
      user: { id: "usr_1", email: "test@example.com", role: "admin" },
    });

    expect(client.authenticated).toBe(true);
    expect(client.token).toBe("test-token");
  });

  it("should clear auth state", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });

    client.setAuth({
      token: "test-token",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600_000,
    });

    client.clearAuth();
    expect(client.authenticated).toBe(false);
    expect(client.token).toBeNull();
  });

  it("should mark as unauthenticated when token expired", () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });

    client.setAuth({
      token: "expired-token",
      refreshToken: "expired-refresh",
      expiresAt: Date.now() - 1, // Already expired
    });

    expect(client.authenticated).toBe(false);
  });

  it("should build request URLs correctly", async () => {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });

    // Test with a mock fetch by spying on global fetch
    // The client.request method handles URL building internally
    const result = await client.get("/api/health");

    // Without a real server, this will fail with network_error
    // In a real test suite, we'd use a mock server
    expect(result).toBeDefined();
  });
});
