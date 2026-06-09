import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { login, register, refreshAuth, logout, getOAuth2Url, handleOAuth2Callback, loginWithGoogle, loginWithGitHub } from "../src/auth";

describe("Auth Module", () => {
  describe("login", () => {
    it("should authenticate and set auth state", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });

      // Mock the request method
      let requestPath = "";
      (client as any).request = async (path: string, options: any) => {
        requestPath = path;
        return {
          success: true,
          data: {
            accessToken: "tok_123",
            refreshToken: "ref_456",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            user: { id: "usr_1", email: "test@example.com", role: "admin" },
          },
        };
      };

      const state = await login(client, { email: "test@example.com", password: "secret" } as any);

      expect(requestPath).toBe("/api/auth/login");
      expect(state.token).toBe("tok_123");
      expect(state.refreshToken).toBe("ref_456");
      expect(client.authenticated).toBe(true);
    });

    it("should throw on failed login", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      (client as any).request = async () => ({
        success: false,
        error: { message: "Invalid credentials" },
      });

      try {
        await login(client, { email: "bad", password: "bad" } as any);
        expect(false).toBe(true);
      } catch (err) {
        expect((err as Error).message).toContain("Invalid credentials");
      }
    });
  });

  describe("register", () => {
    it("should register and set auth state", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      (client as any).request = async () => ({
        success: true,
        data: {
          accessToken: "tok_new",
          refreshToken: "ref_new",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "usr_new", email: "new@example.com", role: "user" },
        },
      });

      const state = await register(client, { email: "new@example.com", password: "secret" } as any);
      expect(state.token).toBe("tok_new");
    });
  });

  describe("refreshAuth", () => {
    it("should refresh token and update auth state", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      (client as any).request = async () => ({
        success: true,
        data: {
          accessToken: "tok_refreshed",
          refreshToken: "ref_refreshed",
          expiresAt: Math.floor(Date.now() / 1000) + 7200,
        },
      });

      const state = await refreshAuth(client, "old_refresh");
      expect(state.token).toBe("tok_refreshed");
      expect(client.token).toBe("tok_refreshed");
    });

    it("should clear auth on refresh failure", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      client.setAuth({ token: "old", refreshToken: "old", expiresAt: Date.now() + 3600_000 });

      (client as any).request = async () => ({
        success: false,
        error: { message: "Token revoked" },
      });

      try {
        await refreshAuth(client, "old_refresh");
      } catch {
        // expected
      }
      expect(client.authenticated).toBe(false);
    });
  });

  describe("logout", () => {
    it("should clear auth state after logout", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      client.setAuth({ token: "t", refreshToken: "r", expiresAt: Date.now() + 3600_000 });

      (client as any).request = async () => ({ success: true });

      await logout(client);
      expect(client.authenticated).toBe(false);
    });
  });

  describe("OAuth2 helpers", () => {
    it("should generate Google OAuth2 URL", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const url = loginWithGoogle(client, "http://app.com/callback");
      expect(url).toContain("/api/auth/oauth2/google");
      expect(url).toContain("redirect_uri=" + encodeURIComponent("http://app.com/callback"));
    });

    it("should generate GitHub OAuth2 URL", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const url = loginWithGitHub(client, "http://app.com/callback");
      expect(url).toContain("/api/auth/oauth2/github");
      expect(url).toContain("redirect_uri=" + encodeURIComponent("http://app.com/callback"));
    });

    it("should handle OAuth2 callback", async () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      (client as any).request = async () => ({
        success: true,
        data: {
          accessToken: "tok_oauth",
          refreshToken: "ref_oauth",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "usr_oauth", email: "oauth@example.com", role: "user" },
        },
      });

      const state = await handleOAuth2Callback(client, "google", "auth-code-123");
      expect(state.token).toBe("tok_oauth");
      expect(client.authenticated).toBe(true);
    });
  });
});
