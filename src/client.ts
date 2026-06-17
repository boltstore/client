import type {
  ApiResponse,
  CollectionInfo,
  BoltstoreRecord,
  ListOptions,
  BatchOperation,
  BatchResult,
  QueryOptions,
} from "@boltstore/utils";

import { BoltstoreError } from "./errors";
import { decodeJwtPayload } from "./jwt";
import { TypedCollectionImpl, type MinimalClient } from "./typed-collection";
import type { TypedCollection } from "./types";
import type {
  HttpMethod,
  TokenPair,
  UserProfile,
  OAuthProvider,
  ClientConfig,
  HealthCheck,
  PaginatedResult,
  TypedRecord,
  TypedBatchOperation,
  PaginateOptions,
} from "./types";

export { BoltstoreError };
export { TypedCollectionImpl } from "./typed-collection";
export type { TypedCollection } from "./typed-collection";
export type {
  TokenPair,
  UserProfile,
  OAuthProvider,
  ClientConfig,
  HealthCheck,
  PaginatedResult,
  PaginateOptions,
  TypedRecord,
  TypedBatchOperation,
};

export class BoltstoreClient {
  private baseUrl: string;
  private database: string | undefined;
  private token: string | undefined;
  private refreshToken: string | undefined;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.database = config.database;
    this.token = config.token;
    this.refreshToken = config.refreshToken;
  }

  collection<Fields = Record<string, unknown>>(name: string): TypedCollection<Fields> {
    return new TypedCollectionImpl<Fields>(this, name, (path: string) => this.dbPath(path));
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  setRefreshToken(token: string | undefined): void {
    this.refreshToken = token;
  }

  getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  auth = {
    register: async (email: string, password: string): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("POST", this.dbPath("/auth/register"), { email, password });
      return res.data!;
    },

    login: async (email: string, password: string): Promise<TokenPair> => {
      const res = await this.request<TokenPair>("POST", this.dbPath("/auth/login"), { email, password });
      this.token = res.data!.accessToken;
      this.refreshToken = res.data!.refreshToken;
      return res.data!;
    },

    refresh: async (refreshToken?: string): Promise<TokenPair> => {
      const token = refreshToken || this.refreshToken;
      if (!token) throw new BoltstoreError(400, "MISSING_REFRESH_TOKEN", "No refresh token available.");
      const res = await this.request<TokenPair>("POST", this.dbPath("/auth/refresh"), { refreshToken: token });
      this.token = res.data!.accessToken;
      this.refreshToken = res.data!.refreshToken;
      return res.data!;
    },

    autoRefresh: async (thresholdSeconds = 60): Promise<TokenPair | null> => {
      if (!this.token || !this.refreshToken) return null;
      const payload = decodeJwtPayload(this.token);
      if (!payload || !payload.exp) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp - nowSec > thresholdSeconds) return null;
      return this.auth.refresh();
    },

    logout: async (): Promise<void> => {
      await this.request("POST", this.dbPath("/auth/logout"));
      this.token = undefined;
      this.refreshToken = undefined;
    },

    me: async (): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("GET", this.dbPath("/auth/me"));
      return res.data!;
    },

    updateProfile: async (data: { email?: string; password?: string }): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("PATCH", this.dbPath("/auth/me"), data);
      return res.data!;
    },

    oauthUrl: async (provider: OAuthProvider, redirectUri: string): Promise<string> => {
      const res = await this.request<{ url: string }>(
        "GET",
        this.dbPath(`/auth/oauth/${provider}/url?redirect_uri=${encodeURIComponent(redirectUri)}`)
      );
      return res.data!.url;
    },

    oauthExchange: async (provider: OAuthProvider, code: string, redirectUri: string): Promise<TokenPair> => {
      const res = await this.request<TokenPair>("POST", this.dbPath(`/auth/oauth/${provider}`), {
        code,
        redirect_uri: redirectUri,
      });
      this.token = res.data!.accessToken;
      this.refreshToken = res.data!.refreshToken;
      return res.data!;
    },
  };

  health = {
    check: async (): Promise<HealthCheck> => {
      const res = await this.request<HealthCheck>("GET", "/api/health");
      return res.data ?? { status: "unknown", version: "", uptime: 0, timestamp: "" };
    },
  };

  collections = {
    list: async (): Promise<CollectionInfo[]> => {
      const res = await this.request<CollectionInfo[]>("GET", this.dbPath("/collections"));
      return res.data ?? [];
    },

    get: async (name: string): Promise<CollectionInfo> => {
      const res = await this.request<CollectionInfo>("GET", this.dbPath(`/collections/${name}`));
      return res.data!;
    },
  };

  records = {
    create: async (collection: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("POST", this.dbPath(`/collections/${collection}/records`), data);
      return res.data!;
    },

    list: async (collection: string, options?: ListOptions): Promise<BoltstoreRecord[]> => {
      const path = this.buildListPath(collection, options);
      const res = await this.request<BoltstoreRecord[]>("GET", path);
      return res.data ?? [];
    },

    get: async (collection: string, id: string): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("GET", this.dbPath(`/collections/${collection}/records/${id}`));
      return res.data!;
    },

    update: async (collection: string, id: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("PATCH", this.dbPath(`/collections/${collection}/records/${id}`), data);
      return res.data!;
    },

    delete: async (collection: string, id: string): Promise<void> => {
      await this.request("DELETE", this.dbPath(`/collections/${collection}/records/${id}`));
    },

    count: async (collection: string, filter?: Record<string, unknown>): Promise<number> => {
      const params = new URLSearchParams();
      if (filter) {
        for (const [k, v] of Object.entries(filter)) {
          if (v === null || v === undefined) continue;
          if (typeof v === "object" && !Array.isArray(v)) {
            throw new BoltstoreError(400, "INVALID_FILTER", `Filter value for "${k}" must be a scalar or array.`);
          }
          params.set(k, Array.isArray(v) ? v.join(",") : String(v));
        }
      }
      const qs = params.toString();
      const path = this.dbPath(`/collections/${collection}/records/count`) + (qs ? `?${qs}` : "");
      const res = await this.request<{ count: number }>("GET", path);
      return res.data?.count ?? 0;
    },

    distinct: async (collection: string, field: string): Promise<unknown[]> => {
      const res = await this.request<{ field: string; values: unknown[] }>(
        "GET",
        this.dbPath(`/collections/${collection}/records/distinct?field=${encodeURIComponent(field)}`)
      );
      return res.data?.values ?? [];
    },

    batch: async (collection: string, operations: BatchOperation[]): Promise<BatchResult> => {
      const res = await this.request<BatchResult>("POST", this.dbPath(`/collections/${collection}/records/batch`), operations);
      return res.data!;
    },

    paginate: async (collection: string, options: PaginateOptions): Promise<PaginatedResult<BoltstoreRecord>> => {
      const perPage = options.perPage ?? 50;
      const params = new URLSearchParams();
      params.set("page", String(options.page));
      params.set("per_page", String(perPage));
      if (options.sort) params.set("sort", options.sort);
      if (options.direction) params.set("direction", options.direction);
      if (options.filter) {
        for (const [k, v] of Object.entries(options.filter)) {
          if (v === null || v === undefined) continue;
          if (typeof v === "object" && !Array.isArray(v)) {
            throw new BoltstoreError(400, "INVALID_FILTER", `Filter value for "${k}" must be a scalar or array.`);
          }
          params.set(k, Array.isArray(v) ? v.join(",") : String(v));
        }
      }
      const qs = params.toString();
      const path = this.dbPath(`/collections/${collection}/records`) + (qs ? `?${qs}` : "");
      const res = await this.request<BoltstoreRecord[]>("GET", path);
      const meta = res.meta ?? {};
      return {
        data: res.data ?? [],
        meta: {
          page: (meta.page as number) ?? options.page,
          per_page: (meta.per_page as number) ?? perPage,
          total: (meta.total as number) ?? (res.data?.length ?? 0),
          total_pages: (meta.total_pages as number) ?? 1,
        },
      };
    },

    listAll: async (collection: string, options?: Omit<PaginateOptions, "page">): Promise<BoltstoreRecord[]> => {
      const perPage = options?.perPage ?? 100;
      const maxPages = 1000;
      const all: BoltstoreRecord[] = [];
      let page = 1;

      while (true) {
        const result = await this.records.paginate(collection, { ...options, page, perPage });
        all.push(...result.data);
        if (page >= result.meta.total_pages) break;
        if (page >= maxPages) throw new BoltstoreError(400, "TOO_MANY_PAGES", `listAll stopped after ${maxPages} pages.`);
        page++;
      }

      return all;
    },
  };

  async query(options: QueryOptions): Promise<{ data: BoltstoreRecord[]; meta: Record<string, unknown> }> {
    const res = await this.request<BoltstoreRecord[]>("POST", this.dbPath("/query"), options);
    return { data: res.data ?? [], meta: res.meta ?? {} };
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown, retries = 1): Promise<ApiResponse<T>> {
    if (this.refreshToken && this.token) {
      try { await this.auth.autoRefresh(); } catch { /* ignore auto-refresh failures */ }
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
        let json: ApiResponse<T>;
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          const text = await response.text();
          throw new BoltstoreError(
            response.status,
            "INVALID_RESPONSE",
            `Expected JSON response, got ${contentType} (status ${response.status}): ${text.slice(0, 200)}`
          );
        }
        try {
          json = (await response.json()) as ApiResponse<T>;
        } catch {
          throw new BoltstoreError(response.status, "PARSE_ERROR", `Failed to parse response from Boltstore server (status ${response.status}).`);
        }
        if (json.error) {
          throw new BoltstoreError(response.status, json.error.code, json.error.message, json.error.details);
        }
        return json;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError = lastError.message.includes("fetch") || lastError.message.includes("network");
        if (attempt < retries && isNetworkError) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    if (lastError instanceof BoltstoreError) throw lastError;
    throw new BoltstoreError(0, "NETWORK_ERROR", lastError?.message || "Network request failed");
  }

  dbPath(path: string): string {
    if (this.database) return `/api/${this.database}${path}`;
    return `/api${path}`;
  }

  buildListPath(collection: string, options?: ListOptions): string {
    const params = new URLSearchParams();
    if (options?.sort) params.set("sort", options.sort);
    if (options?.direction) params.set("direction", options.direction);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    if (options?.page !== undefined) params.set("page", String(options.page));
    if (options?.perPage !== undefined) params.set("per_page", String(options.perPage));
    if (options?.fields) params.set("fields", options.fields.join(","));
    if (options?.expand) params.set("expand", options.expand.join(","));
    if (options?.filter) {
      for (const [k, v] of Object.entries(options.filter)) {
        if (v === null || v === undefined) continue;
        if (typeof v === "object" && !Array.isArray(v)) continue;
        params.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
    }
    const qs = params.toString();
    return this.dbPath(`/collections/${collection}/records`) + (qs ? `?${qs}` : "");
  }
}

export default BoltstoreClient;