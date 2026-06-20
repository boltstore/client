import type {
  ApiResponse,
  ListOptions,
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
import type { LocalStore } from "./store/types";
import { IndexedDbStore, MemoryStore } from "./store";
import { RealtimeConnection } from "./ws/connection";
import { SubscriptionManager } from "./ws/subscription";
import { SyncManager, type SyncConfig } from "./sync";

export { BoltstoreError };
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

function detectLocalStore(): LocalStore {
  if (typeof indexedDB !== "undefined") {
    return new IndexedDbStore();
  }
  return new MemoryStore();
}

export class BoltstoreClient {
  private baseUrl: string;
  private databaseId: string;
  private token: string | undefined;
  private refreshToken: string | undefined;
  private colRegistry = new Map<string, TypedCollectionImpl<unknown>>();
  private subManager: SubscriptionManager;
  private syncMgr: SyncManager;

  auth: ReturnType<typeof createAuthApi>;
  health: ReturnType<typeof createHealthApi>;
  collections: ReturnType<typeof createCollectionsApi>;
  localStore: LocalStore;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.databaseId = config.databaseId;
    this.token = config.token;
    this.refreshToken = config.refreshToken;
    this.localStore = config.localStore ?? detectLocalStore();

    this.auth = createAuthApi(this);
    this.health = createHealthApi(this);
    this.collections = createCollectionsApi(this);

    // Internal sync manager for offline queue
    this.syncMgr = new SyncManager(this, config.sync as SyncConfig | undefined);
    this.syncMgr.localStore = this.localStore;

    // Internal WebSocket connection for realtime sync
    const wsConn = new RealtimeConnection(
      this.baseUrl,
      () => this.token,
      { databaseId: this.databaseId },
    );
    this.subManager = new SubscriptionManager(
      (msg) => wsConn.send(msg),
      (handler) => wsConn.onMessage(handler),
      (handler) => wsConn.onStateChange(handler),
    );
    this.subManager.setLocalStore(this.localStore);

    // Wire online/offline to sync queue
    wsConn.onStateChange((state) => {
      if (state === "connected") {
        this.syncMgr.setOnline(true);
        this.syncMgr.listenForOnline();
      } else if (state === "disconnected" || state === "reconnecting") {
        this.syncMgr.setOnline(false);
      }
    });

    wsConn.connect();
  }

  collection<Fields = Record<string, unknown>>(name: string): TypedCollection<Fields> {
    let col = this.colRegistry.get(name) as TypedCollectionImpl<Fields> | undefined;
    if (!col) {
      col = new TypedCollectionImpl<Fields>(this, name, (path: string) => this.dbPath(path), this.subManager);
      this.colRegistry.set(name, col as TypedCollectionImpl<unknown>);
    }
    return col;
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

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown, retries = 1): Promise<ApiResponse<T>> {
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
        const contentType = response.headers.get("Content-Type") || "";
        const text = await response.text().catch(() => undefined);

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
        if (attempt < retries && isNetworkError) {
          const delay = 500 * (attempt + 1);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delay);
          });
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
