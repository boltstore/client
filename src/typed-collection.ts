import { BoltstoreError } from "./errors";
import type { ListOptions, QueryOptions, BatchResult, RecordEvent } from "@boltstore/utils";
import type { LocalStore } from "./store/types";
import type {
  TypedCollection,
  TypedBatchOperation,
  TypedRecord,
  PaginatedResult,
  PaginateOptions,
} from "./types";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export interface MinimalClient {
  request<T = unknown>(method: HttpMethod, path: string, body?: unknown, retries?: number): Promise<ApiResponse<T>>;
  buildListPath(collection: string, options?: ListOptions): string;
  localStore: LocalStore | null;
  /** Enqueue operations for offline sync. Called automatically on network errors. */
  enqueueSync?(ops: Array<{ event: "create" | "update" | "delete"; collection: string; id?: string; data?: Record<string, unknown> }>): void;
}

export type { TypedCollection, TypedBatchOperation };

export class TypedCollectionImpl<Fields> implements TypedCollection<Fields> {
  private subManager: import("./ws/subscription").SubscriptionManager | null;

  constructor(
    private client: MinimalClient,
    private name: string,
    private dbPath: (path: string) => string,
    subManager?: import("./ws/subscription").SubscriptionManager,
  ) {
    this.subManager = subManager ?? null;
  }

  private get store(): LocalStore | null {
    return this.client.localStore;
  }

  private get isUserCol(): boolean {
    return !this.name.startsWith("_");
  }

  async create(data: Omit<Fields, "id" | "created_at" | "updated_at">): Promise<TypedRecord<Fields>> {
    if (this.store && this.isUserCol) {
      const localData = { ...data, id: crypto.randomUUID() } as unknown as Record<string, unknown>;
      await this.store.insert(this.name, [localData]).catch(() => {});
      try {
        const res = await this.client.request<TypedRecord<Fields>>(
          "POST",
          this.dbPath(`/collections/${this.name}/records`),
          data as Record<string, unknown>,
        );
        // Reconcile: update local with server response
        if (res.data && this.store) {
          await this.store.update(this.name, localData.id as string, res.data as unknown as Record<string, unknown>).catch(() => {});
        }
        return res.data!;
      } catch (err) {
        // Network error: keep local write and queue for sync with the local ID
        if (err instanceof BoltstoreError && err.code === "NETWORK_ERROR") {
          this.client.enqueueSync?.([{ event: "create", collection: this.name, id: localData.id as string, data: { ...data as Record<string, unknown>, id: localData.id } }]);
          return { ...localData, id: localData.id } as unknown as TypedRecord<Fields>;
        }
        // Other errors: revert local write
        await this.store.delete(this.name, localData.id as string).catch(() => {});
        throw err;
      }
    }
    const res = await this.client.request<TypedRecord<Fields>>(
      "POST",
      this.dbPath(`/collections/${this.name}/records`),
      data as Record<string, unknown>,
    );
    if (res.data && this.store && this.isUserCol) {
      await this.store.insert(this.name, [res.data as unknown as Record<string, unknown>]).catch(() => {});
    }
    return res.data!;
  }

  async list(options?: ListOptions): Promise<TypedRecord<Fields>[]> {
    const path = this.client.buildListPath(this.name, options);
    try {
      const res = await this.client.request<TypedRecord<Fields>[]>("GET", path);
      if (res.data && this.store && this.isUserCol) {
        await this.store.insert(this.name, res.data as unknown as Record<string, unknown>[]).catch(() => {});
      }
      return res.data ?? [];
    } catch (err) {
      if (this.store && this.isUserCol) {
        // Offline fallback: use local query which supports search/filter/sort
        const qOpts: QueryOptions = { collection: this.name };
        if (options?.search) qOpts.search = options.search;
        if (options?.searchFields) qOpts.searchFields = options.searchFields;
        if (options?.sort) qOpts.sort = [{ field: options.sort, direction: options.direction ?? "asc" }];
        if (options?.limit != null) qOpts.limit = options.limit;
        if (options?.offset) qOpts.offset = options.offset;
        const cached = await this.store.query(qOpts);
        return cached.data as unknown as TypedRecord<Fields>[];
      }
      // If the collection doesn't exist yet (NOT_FOUND), return empty
      if (err instanceof BoltstoreError && err.code === "NOT_FOUND") {
        return [];
      }
      // If online but got a different error, rethrow
      throw err instanceof BoltstoreError ? err : new BoltstoreError(0, "NETWORK_ERROR", `Cannot reach server and no local cache for ${this.name}.`);
    }
  }

  async get(id: string): Promise<TypedRecord<Fields>> {
    try {
      const res = await this.client.request<TypedRecord<Fields>>(
        "GET",
        this.dbPath(`/collections/${this.name}/records/${id}`),
      );
      if (res.data && this.store && this.isUserCol) {
        await this.store.insert(this.name, [res.data as unknown as Record<string, unknown>]).catch(() => {});
      }
      return res.data!;
    } catch {
      if (this.store && this.isUserCol) {
        const cached = await this.store.get(this.name, id);
        if (cached) return cached as unknown as TypedRecord<Fields>;
      }
      throw new BoltstoreError(0, "NETWORK_ERROR", `Cannot reach server and no local cache for ${this.name}/${id}.`);
    }
  }

  async update(id: string, data: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>): Promise<TypedRecord<Fields>> {
    if (this.store && this.isUserCol) {
      await this.store.update(this.name, id, data as unknown as Record<string, unknown>).catch(() => {});
    }
    try {
      const res = await this.client.request<TypedRecord<Fields>>(
        "PATCH",
        this.dbPath(`/collections/${this.name}/records/${id}`),
        data as Record<string, unknown>,
      );
      if (res.data && this.store && this.isUserCol) {
        await this.store.update(this.name, id, res.data as unknown as Record<string, unknown>).catch(() => {});
      }
      return res.data!;
    } catch (err) {
      if (err instanceof BoltstoreError && err.code === "NETWORK_ERROR") {
        // Network error: keep local write and queue for sync
        this.client.enqueueSync?.([{ event: "update", collection: this.name, id, data: data as Record<string, unknown> }]);
      } else {
        // Other errors: revert
        if (this.store && this.isUserCol) {
          await this.store.delete(this.name, id).catch(() => {});
        }
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    if (this.store && this.isUserCol) {
      await this.store.delete(this.name, id).catch(() => {});
    }
    try {
      await this.client.request("DELETE", this.dbPath(`/collections/${this.name}/records/${id}`));
    } catch (err) {
      if (err instanceof BoltstoreError && err.code === "NETWORK_ERROR") {
        // Network error: keep local delete and queue for sync
        this.client.enqueueSync?.([{ event: "delete", collection: this.name, id }]);
      } else {
        // Non-network error: revert local delete
        if (this.store && this.isUserCol) {
          await this.store.insert(this.name, [{ id } as unknown as Record<string, unknown>]).catch(() => {});
        }
      }
      throw err;
    }
  }

  async count(filter?: Partial<Fields & Record<string, unknown>>): Promise<number> {
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
    const path = this.dbPath(`/collections/${this.name}/records/count`) + (qs ? `?${qs}` : "");
    const res = await this.client.request<{ count: number }>("GET", path);
    return res.data?.count ?? 0;
  }

  async distinct(field: keyof Fields & string): Promise<unknown[]> {
    const res = await this.client.request<{ field: string; values: unknown[] }>(
      "GET",
      this.dbPath(`/collections/${this.name}/records/distinct?field=${encodeURIComponent(field as string)}`),
    );
    return res.data?.values ?? [];
  }

  async batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult> {
    const res = await this.client.request<BatchResult>(
      "POST",
      this.dbPath(`/collections/${this.name}/records/batch`),
      operations,
    );
    return res.data!;
  }

  async paginate(options: PaginateOptions): Promise<PaginatedResult<TypedRecord<Fields>>> {
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
    const path = this.dbPath(`/collections/${this.name}/records`) + (qs ? `?${qs}` : "");
    const res = await this.client.request<TypedRecord<Fields>[]>("GET", path);
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
  }

  subscribe(callback: (event: RecordEvent) => void): () => void {
    if (this.subManager) {
      const localId = this.subManager.subscribe(this.name, { onEvent: callback });
      return () => {
        this.subManager?.unsubscribe(localId);
      };
    }
    return () => {};
  }
}