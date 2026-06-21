import type {
  ApiResponse,
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
  TypedRecord,
  TypedBatchOperation,
} from "./types";
import type { QueryResponse } from "./query-builder";
import { ClientQueryBuilder } from "./query-builder";
import { createAuthApi } from "./api/auth";
import { createHealthApi } from "./api/health";
import { createCollectionsApi } from "./api/collections";
import type { LocalStore } from "./store/types";
import { IndexedDbStore, MemoryStore } from "./store";
import { RealtimeConnection } from "./ws/connection";
import { SubscriptionManager } from "./ws/subscription";
import { SyncManager } from "./sync";

export { BoltstoreError };
export type { TypedCollection } from "./typed-collection";
export type {
  TokenPair,
  UserProfile,
  OAuthProvider,
  ClientConfig,
  HealthCheck,
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
  private subManager: SubscriptionManager | null = null;
  private syncMgr: SyncManager | null = null;
  private realtimeEnabled: boolean;
  private syncEnabled: boolean;

  auth: ReturnType<typeof createAuthApi>;
  health: ReturnType<typeof createHealthApi>;
  collections: ReturnType<typeof createCollectionsApi>;
  localStore: LocalStore | null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.databaseId = config.databaseId;
    this.token = config.token;
    this.refreshToken = config.refreshToken;
    this.realtimeEnabled = config.enableRealtime ?? false;
    this.syncEnabled = config.enableSync ?? false;

    if (this.syncEnabled) {
      this.localStore = config.localStore ?? detectLocalStore();
      this.syncMgr = new SyncManager(this);
      this.syncMgr.localStore = this.localStore;
    } else {
      this.localStore = null;
    }

    this.auth = createAuthApi(this);
    this.health = createHealthApi(this);
    this.collections = createCollectionsApi(this);

    if (this.realtimeEnabled) {
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
      if (this.localStore) {
        this.subManager.setLocalStore(this.localStore);
      }
      if (this.syncMgr) {
        wsConn.onStateChange((state) => {
          if (state === "connected") {
            this.syncMgr!.setOnline(true);
            this.syncMgr!.listenForOnline();
          } else if (state === "disconnected" || state === "reconnecting") {
            this.syncMgr!.setOnline(false);
          }
        });
      }
      wsConn.connect();
    }
  }

  /** Enqueue operations for offline sync. Called by TypedCollectionImpl on network errors. */
  enqueueSync(ops: Array<{ event: "create" | "update" | "delete"; collection: string; id?: string; data?: Record<string, unknown> }>): void {
    this.syncMgr?.push(ops.map((op) => ({
      event: op.event,
      collection: op.collection,
      id: op.id,
      data: op.data,
    }))).catch(() => {});
  }

  createQuery<Fields = Record<string, unknown>>(): ClientQueryBuilder<Fields> {
    const sendQuery = async (params: QueryOptions): Promise<QueryResponse<Fields>> => {
      const res = await this.request<Fields[]>("POST", this.dbPath("/query"), params);
      if (this.localStore && !params.collection.startsWith("_") && res.data && res.data.length > 0) {
        await this.localStore.insert(params.collection, res.data as unknown as Record<string, unknown>[]).catch(() => {});
      }
      return { data: res.data ?? [], meta: res.meta ?? {} };
    };
    return new ClientQueryBuilder<Fields>(sendQuery, this.localStore);
  }

  collection<Fields = Record<string, unknown>>(name: string): TypedCollection<Fields> {
    let col = this.colRegistry.get(name) as TypedCollectionImpl<Fields> | undefined;
    if (!col) {
      col = new TypedCollectionImpl<Fields>(this, name, (path: string) => this.dbPath(path), this.subManager ?? undefined);
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

        // On 401, try token refresh once and retry
        if (response.status === 401 && this.refreshToken && !path.endsWith("/auth/refresh") && !path.endsWith("/auth/login")) {
          try {
            await this.auth.autoRefresh();
            headers["Authorization"] = `Bearer ${this.token}`;
            const retryResponse = await globalThis.fetch(`${this.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
            const retryText = await retryResponse.text().catch(() => undefined);
            if (retryText) {
              const retryJson = JSON.parse(retryText);
              if (retryJson.error) throw new BoltstoreError(retryResponse.status, retryJson.error.code, retryJson.error.message, retryJson.error.details);
              return retryJson as ApiResponse<T>;
            }
          } catch { /* refresh failed — fall through */ }
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
}
