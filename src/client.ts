// ── Boltstore Client ──
// Main client class. Configures the connection, manages auth state,
// and provides helpers for making API requests.

import type { ApiResponse, PaginationParams } from "@boltstore/shared";
import type { LoginResponse, RefreshResponse } from "@boltstore/shared/auth-types";
import type { PlatformAdapter } from "./adapters/node";

export interface ClientConfig {
  /** Base URL of the Boltstore server */
  url: string;
  /** Application ID (if scoping to a single application) */
  applicationId?: string;
  /** Request timeout in ms (default: 30s) */
  timeout?: number;
  /** Auto-refresh tokens before expiry */
  autoRefresh?: boolean;
  /** Platform-specific adapter (auto-detected if not provided) */
  adapter?: PlatformAdapter;
}

export interface AuthState {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user?: {
    id: string;
    email: string;
    role: string;
    avatar?: string;
  };
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | undefined>;
}

export class BoltstoreClient {
  private config: ClientConfig;
  private authState: AuthState | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ClientConfig) {
    this.config = {
      timeout: 30_000,
      autoRefresh: true,
      ...config,
    };
  }

  // ── Auth State ──

  get authenticated(): boolean {
    return this.authState !== null && this.authState.expiresAt > Date.now();
  }

  get token(): string | null {
    return this.authState?.token ?? null;
  }

  setAuth(state: AuthState): void {
    this.authState = state;
    if (this.config.autoRefresh) {
      this.scheduleRefresh();
    }
  }

  clearAuth(): void {
    this.authState = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ── Request Helper ──

  /**
   * Make a request to the Boltstore API.
   * Automatically adds Authorization header and handles token refresh.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { method = "GET", body, headers = {}, params } = options;

    // Build URL with query params
    let url = `${this.config.url}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, value);
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    // Add auth header
    if (this.authState?.token) {
      headers["Authorization"] = `Bearer ${this.authState.token}`;
    }

    // Add application header
    if (this.config.applicationId) {
      headers["X-Application-Id"] = this.config.applicationId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const json = (await response.json()) as ApiResponse<T>;

      // Handle authentication errors
      if (response.status === 401 && json.error?.code === "token_expired") {
        this.clearAuth();
      }

      return json;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          success: false,
          error: { code: "timeout", message: `Request timed out after ${this.config.timeout}ms` },
        };
      }
      return {
        success: false,
        error: { code: "network_error", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // ── Token Refresh ──

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.authState) return;

    const refreshIn = this.authState.expiresAt - Date.now() - 60_000; // 1 minute before expiry
    if (refreshIn <= 0) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshToken().catch(() => {
        this.clearAuth();
      });
    }, refreshIn);
  }

  private async refreshToken(): Promise<void> {
    if (!this.authState?.refreshToken) return;

    const result = await this.request<RefreshResponse>("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: this.authState.refreshToken },
    });

    if (result.success && result.data) {
      this.setAuth({
        token: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        expiresAt: result.data.expiresAt * 1000,
        user: this.authState.user,
      });
    }
  }

  // ── Convenience Methods ──

  get<T = unknown>(path: string, params?: Record<string, string | undefined>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { params });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "POST", body });
  }

  patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: "DELETE" });
  }
}
