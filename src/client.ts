import type {
  ApiResponse,
  BoltstoreRecord,
  ListOptions,
  QueryOptions,
} from "@boltstore/utils";

import { BoltstoreError } from "./errors";
import { TypedCollectionImpl } from "./typed-collection";
import type { TypedCollection } from "./typed-collection";
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
import { createAuthApi } from "./api/auth";
import { createHealthApi } from "./api/health";
import { createCollectionsApi } from "./api/collections";
import { createRecordsApi } from "./api/records";
import { Realtime } from "./ws/realtime";

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
  private databaseId: string;
  private token: string | undefined;
  private refreshToken: string | undefined;
  private realtimeConfig: ClientConfig["realtime"];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  auth: ReturnType<typeof createAuthApi>;
  health: ReturnType<typeof createHealthApi>;
  collections: ReturnType<typeof createCollectionsApi>;
  records: ReturnType<typeof createRecordsApi>;
  private _realtime: Realtime | null = null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.databaseId = config.databaseId;
    this.token = config.token;
    this.refreshToken = config.refreshToken;
    this.realtimeConfig = config.realtime;

    this.auth = createAuthApi(this);
    this.health = createHealthApi(this);
    this.collections = createCollectionsApi(this);
    this.records = createRecordsApi(this);
  }

  /** Dispose the client, cancelling any in-flight retries. */
  dispose(): void {
    this.closed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  get realtime(): Realtime {
    if (!this._realtime) {
      this._realtime = new Realtime(
        this.baseUrl,
        () => this.token,
        {
          databaseId: this.databaseId,
          ...this.realtimeConfig,
        },
      );
    }
    return this._realtime;
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
      if (this.closed) throw new BoltstoreError(0, "CLIENT_DISPOSED", "Client has been disposed.");
      try {
        const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
        const contentType = response.headers.get("Content-Type") || "";
        let text: string | undefined;
        // Always try to get the body as text first for better error handling
        try {
          text = await response.text();
        } catch {
          // Response body may be empty
        }
        if (contentType.includes("application/json") || (text && (text.startsWith("{") || text.startsWith("[")))) {
          try {
            const json = text ? JSON.parse(text) : {};
            if (json.error) {
              throw new BoltstoreError(response.status, json.error.code, json.error.message, json.error.details);
            }
            return json as ApiResponse<T>;
          } catch (err) {
            if (err instanceof BoltstoreError) throw err;
            throw new BoltstoreError(response.status, "PARSE_ERROR", `Failed to parse response from Boltstore server (status ${response.status}).`);
          }
        }
        throw new BoltstoreError(
          response.status,
          "INVALID_RESPONSE",
          `Expected JSON response, got ${contentType} (status ${response.status}): ${(text || "").slice(0, 200)}`
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError = lastError.message.includes("fetch") || lastError.message.includes("network");
        if (attempt < retries && isNetworkError && !this.closed) {
          const delay = 500 * (attempt + 1);
          await new Promise<void>((resolve) => {
            this.retryTimer = setTimeout(resolve, delay);
          });
          this.retryTimer = null;
          continue;
        }
        break;
      }
    }

    if (lastError instanceof BoltstoreError) throw lastError;
    throw new BoltstoreError(0, "NETWORK_ERROR", lastError?.message || "Network request failed");
  }

  dbPath(path: string): string {
    return `/api/${this.databaseId}${path}`;
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
