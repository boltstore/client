// ── Auth Module ──
// Authentication operations: login, register, refresh, logout, OAuth2.

import type { BoltstoreClient, AuthState } from "./client";
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RefreshResponse,
  OAuth2Provider,
} from "@boltstore/shared/auth-types";

/**
 * Authenticate with email and password.
 * Returns an AuthState that can be passed to client.setAuth().
 */
export async function login(
  client: BoltstoreClient,
  credentials: LoginRequest
): Promise<AuthState> {
  const result = await client.request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: credentials,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Login failed");
  }

  const state: AuthState = {
    token: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresAt: result.data.expiresAt * 1000,
    user: result.data.user,
  };

  client.setAuth(state);
  return state;
}

/**
 * Register a new user account.
 */
export async function register(
  client: BoltstoreClient,
  data: RegisterRequest
): Promise<AuthState> {
  const result = await client.request<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: data,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Registration failed");
  }

  const state: AuthState = {
    token: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresAt: result.data.expiresAt * 1000,
    user: result.data.user,
  };

  client.setAuth(state);
  return state;
}

/**
 * Refresh the access token using a refresh token.
 */
export async function refreshAuth(
  client: BoltstoreClient,
  refreshToken: string
): Promise<AuthState> {
  const result = await client.request<RefreshResponse>("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  });

  if (!result.success || !result.data) {
    client.clearAuth();
    throw new Error(result.error?.message ?? "Token refresh failed");
  }

  const state: AuthState = {
    token: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresAt: result.data.expiresAt * 1000,
  };

  client.setAuth(state);
  return state;
}

/**
 * Logout — invalidate the refresh token on the server.
 */
export async function logout(client: BoltstoreClient): Promise<void> {
  await client.request("/api/auth/logout", { method: "POST" });
  client.clearAuth();
}

/**
 * Get the OAuth2 authorization URL for a provider.
 * Redirect the user to this URL to start the OAuth2 flow.
 */
export function getOAuth2Url(
  client: any, // BoltstoreClient (avoid circular ref)
  provider: OAuth2Provider,
  redirectUri: string
): string {
  const baseUrl = (client as { config?: { url?: string } })?.config?.url ?? "";
  return `${baseUrl}/api/auth/oauth2/${provider}?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

/**
 * Handle OAuth2 callback — exchange code for auth state.
 */
export async function handleOAuth2Callback(
  client: BoltstoreClient,
  provider: OAuth2Provider,
  code: string
): Promise<AuthState> {
  const result = await client.request<LoginResponse>(
    `/api/auth/oauth2/${provider}/callback?code=${encodeURIComponent(code)}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "OAuth2 authentication failed");
  }

  const state: AuthState = {
    token: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresAt: result.data.expiresAt * 1000,
    user: result.data.user,
  };

  client.setAuth(state);
  return state;
}

/**
 * Start a Google OAuth2 login flow.
 * Returns the authorization URL. In a browser, redirect the user to this URL.
 */
export function loginWithGoogle(
  client: BoltstoreClient,
  redirectUri: string
): string {
  return getOAuth2Url(client, "google", redirectUri);
}

/**
 * Start a GitHub OAuth2 login flow.
 * Returns the authorization URL. In a browser, redirect the user to this URL.
 */
export function loginWithGitHub(
  client: BoltstoreClient,
  redirectUri: string
): string {
  return getOAuth2Url(client, "github", redirectUri);
}
