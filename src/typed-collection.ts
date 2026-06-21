import { BoltstoreError } from "./errors";
import type { QueryOptions, BatchResult, RecordEvent } from "@boltstore/utils";
import type { LocalStore } from "./store/types";
import type {
  TypedCollection,
  TypedBatchOperation,
  TypedRecord,
} from "./types";
import { ClientQueryBuilder } from "./query-builder";
import type { QueryResponse } from "./query-builder";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export interface MinimalClient {
  request<T = unknown>(method: HttpMethod, path: string, body?: unknown, retries?: number): Promise<ApiResponse<T>>;
  localStore: LocalStore | null;
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
        if (res.data && this.store) {
          await this.store.update(this.name, localData.id as string, res.data as unknown as Record<string, unknown>).catch(() => {});
        }
        return res.data!;
      } catch (err) {
        if (err instanceof BoltstoreError && err.code === "NETWORK_ERROR") {
          this.client.enqueueSync?.([{ event: "create", collection: this.name, id: localData.id as string, data: { ...data as Record<string, unknown>, id: localData.id } }]);
          return { ...localData, id: localData.id } as unknown as TypedRecord<Fields>;
        }
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
        this.client.enqueueSync?.([{ event: "update", collection: this.name, id, data: data as Record<string, unknown> }]);
      } else {
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
        this.client.enqueueSync?.([{ event: "delete", collection: this.name, id }]);
      } else {
        if (this.store && this.isUserCol) {
          await this.store.insert(this.name, [{ id } as unknown as Record<string, unknown>]).catch(() => {});
        }
      }
      throw err;
    }
  }

  async batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult> {
    const res = await this.client.request<BatchResult>(
      "POST",
      this.dbPath(`/collections/${this.name}/records/batch`),
      operations,
    );
    return res.data!;
  }

  createQuery(): ClientQueryBuilder<TypedRecord<Fields>> {
    const sendQuery = async (params: QueryOptions): Promise<QueryResponse<TypedRecord<Fields>>> => {
      const res = await this.client.request<TypedRecord<Fields>[]>(
        "POST",
        this.dbPath("/query"),
        params,
      );
      if (res.data && this.store && this.isUserCol) {
        await this.store.insert(this.name, res.data as unknown as Record<string, unknown>[]).catch(() => {});
      }
      return { data: res.data ?? [], meta: res.meta ?? {} };
    };
    const qb = new ClientQueryBuilder<TypedRecord<Fields>>(sendQuery, this.store);
    qb.from(this.name);
    return qb;
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