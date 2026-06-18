import type { BoltstoreClient } from "../client";
import type { UserProfile, TokenPair, OAuthProvider } from "../types";
import { decodeJwtPayload } from "../jwt";
import { BoltstoreError } from "../errors";

export function createAuthApi(client: BoltstoreClient) {
  let refreshInFlight: Promise<TokenPair> | null = null;
  let refreshFailedAt = 0;
  const REFRESH_FAILURE_COOLDOWN_MS = 5000;

  const doRefresh = async (refreshToken?: string): Promise<TokenPair> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const token = refreshToken || client.getRefreshToken();
        if (!token) throw new BoltstoreError(400, "MISSING_REFRESH_TOKEN", "No refresh token available.");
        const res = await client.request<TokenPair>("POST", client.dbPath("/auth/refresh"), { refreshToken: token });
        client.setToken(res.data!.accessToken);
        client.setRefreshToken(res.data!.refreshToken);
        refreshFailedAt = 0;
        return res.data!;
      } catch (err) {
        refreshFailedAt = Date.now();
        throw err;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  };

  return {
    register: async (email: string, password: string): Promise<UserProfile> => {
      const res = await client.request<UserProfile>("POST", client.dbPath("/auth/register"), { email, password });
      return res.data!;
    },

    login: async (email: string, password: string): Promise<TokenPair> => {
      const res = await client.request<TokenPair>("POST", client.dbPath("/auth/login"), { email, password });
      client.setToken(res.data!.accessToken);
      client.setRefreshToken(res.data!.refreshToken);
      return res.data!;
    },

    refresh: doRefresh,

    autoRefresh: async (thresholdSeconds = 60): Promise<TokenPair | null> => {
      if (!client.getToken() || !client.getRefreshToken()) return null;
      const payload = decodeJwtPayload(client.getToken()!);
      if (!payload || !payload.exp) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp - nowSec > thresholdSeconds) return null;

      // If a refresh recently failed, skip until the cooldown passes to avoid hammering the server.
      if (refreshFailedAt && Date.now() - refreshFailedAt < REFRESH_FAILURE_COOLDOWN_MS) return null;

      // If a refresh is already in flight, wait for it instead of issuing a duplicate request.
      if (refreshInFlight) {
        try {
          return await refreshInFlight;
        } catch {
          return null;
        }
      }

      try {
        return await doRefresh();
      } catch {
        return null;
      }
    },

    logout: async (): Promise<void> => {
      await client.request("POST", client.dbPath("/auth/logout"));
      client.setToken(undefined);
      client.setRefreshToken(undefined);
    },

    me: async (): Promise<UserProfile> => {
      const res = await client.request<UserProfile>("GET", client.dbPath("/auth/me"));
      return res.data!;
    },

    updateProfile: async (data: { email?: string; password?: string }): Promise<UserProfile> => {
      const res = await client.request<UserProfile>("PATCH", client.dbPath("/auth/me"), data);
      return res.data!;
    },

    oauthUrl: async (provider: OAuthProvider, redirectUri: string): Promise<string> => {
      const res = await client.request<{ url: string }>(
        "GET",
        client.dbPath(`/auth/oauth/${provider}/url?redirect_uri=${encodeURIComponent(redirectUri)}`)
      );
      return res.data!.url;
    },

    oauthExchange: async (provider: OAuthProvider, code: string, redirectUri: string): Promise<TokenPair> => {
      const res = await client.request<TokenPair>("POST", client.dbPath(`/auth/oauth/${provider}`), {
        code,
        redirect_uri: redirectUri,
      });
      client.setToken(res.data!.accessToken);
      client.setRefreshToken(res.data!.refreshToken);
      return res.data!;
    },
  };
}
