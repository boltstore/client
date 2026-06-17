import { BoltstoreError } from "./errors";
import type { BoltstoreRecord, ListOptions, BatchResult } from "@boltstore/utils";
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
}

export type { TypedCollection, TypedBatchOperation };

export class TypedCollectionImpl<Fields> implements TypedCollection<Fields> {
  constructor(
    private client: MinimalClient,
    private name: string,
    private dbPath: (path: string) => string,
  ) {}

  async create(data: Omit<Fields, "id" | "created_at" | "updated_at">): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "POST",
      this.dbPath(`/collections/${this.name}/records`),
      data as Record<string, unknown>,
    );
    return res.data!;
  }

  async list(options?: ListOptions): Promise<TypedRecord<Fields>[]> {
    const path = this.client.buildListPath(this.name, options);
    const res = await this.client.request<TypedRecord<Fields>[]>("GET", path);
    return res.data ?? [];
  }

  async get(id: string): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "GET",
      this.dbPath(`/collections/${this.name}/records/${id}`),
    );
    return res.data!;
  }

  async update(id: string, data: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "PATCH",
      this.dbPath(`/collections/${this.name}/records/${id}`),
      data as Record<string, unknown>,
    );
    return res.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.request("DELETE", this.dbPath(`/collections/${this.name}/records/${id}`));
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
      this.dbPath(`/collections/${this.name}/records/distinct?field=${encodeURIComponent(field)}`),
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

  async listAll(options?: Omit<PaginateOptions, "page">): Promise<TypedRecord<Fields>[]> {
    const perPage = options?.perPage ?? 100;
    const maxPages = 1000;
    const all: TypedRecord<Fields>[] = [];
    let page = 1;

    while (true) {
      const result = await this.paginate({ ...options, page, perPage });
      all.push(...result.data);
      if (page >= result.meta.total_pages) break;
      if (page >= maxPages) throw new BoltstoreError(400, "TOO_MANY_PAGES", `listAll stopped after ${maxPages} pages.`);
      page++;
    }

    return all;
  }
}