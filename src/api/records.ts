import type { BoltstoreClient } from "../client";
import type { BoltstoreRecord, ListOptions, BatchOperation, BatchResult } from "@boltstore/utils";
import type { PaginateOptions, PaginatedResult } from "../types";
import { BoltstoreError } from "../errors";

export function createRecordsApi(client: BoltstoreClient) {
  const ls = () => client.localStore;
  const isUserCol = (c: string) => !c.startsWith("_");

  return {
    create: async (collection: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await client.request<BoltstoreRecord>("POST", client.dbPath(`/collections/${collection}/records`), data);
      if (res.data && ls() && isUserCol(collection)) {
        await ls()!.insert(collection, [res.data as unknown as Record<string, unknown>]).catch(() => {});
      }
      return res.data!;
    },

    list: async (collection: string, options?: ListOptions): Promise<BoltstoreRecord[]> => {
      const path = client.buildListPath(collection, options);
      const store = ls();
      const userCol = isUserCol(collection);
      try {
        const res = await client.request<BoltstoreRecord[]>("GET", path);
        if (res.data && store && userCol) {
          await store.insert(collection, res.data as unknown as Record<string, unknown>[]).catch(() => {});
        }
        return res.data ?? [];
      } catch {
        if (store && userCol) {
          const cached = await store.find(collection, options?.filter, {
            sort: options?.sort,
            direction: options?.direction,
            limit: options?.limit,
            offset: options?.offset,
          });
          return cached as unknown as BoltstoreRecord[];
        }
        throw new BoltstoreError(0, "NETWORK_ERROR", `Cannot reach server and no local cache for ${collection}.`);
      }
    },

    get: async (collection: string, id: string): Promise<BoltstoreRecord> => {
      const store = ls();
      const userCol = isUserCol(collection);
      try {
        const res = await client.request<BoltstoreRecord>("GET", client.dbPath(`/collections/${collection}/records/${id}`));
        if (res.data && store && userCol) {
          await store.insert(collection, [res.data as unknown as Record<string, unknown>]).catch(() => {});
        }
        return res.data!;
      } catch {
        // Server unreachable — fall back to local cache
        if (store && userCol) {
          const cached = await store.get(collection, id);
          if (cached) return cached as unknown as BoltstoreRecord;
        }
        throw new BoltstoreError(0, "NETWORK_ERROR", `Cannot reach server and no local cache for ${collection}/${id}.`);
      }
    },

    update: async (collection: string, id: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await client.request<BoltstoreRecord>("PATCH", client.dbPath(`/collections/${collection}/records/${id}`), data);
      if (res.data && ls() && isUserCol(collection)) {
        await ls()!.update(collection, id, res.data as unknown as Record<string, unknown>).catch(() => {});
      }
      return res.data!;
    },

    delete: async (collection: string, id: string): Promise<void> => {
      await client.request("DELETE", client.dbPath(`/collections/${collection}/records/${id}`));
      if (ls() && isUserCol(collection)) {
        await ls()!.delete(collection, id).catch(() => {});
      }
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
      const path = client.dbPath(`/collections/${collection}/records/count`) + (qs ? `?${qs}` : "");
      const res = await client.request<{ count: number }>("GET", path);
      return res.data?.count ?? 0;
    },

    distinct: async (collection: string, field: string): Promise<unknown[]> => {
      const res = await client.request<{ field: string; values: unknown[] }>(
        "GET",
        client.dbPath(`/collections/${collection}/records/distinct?field=${encodeURIComponent(field)}`)
      );
      return res.data?.values ?? [];
    },

    batch: async (collection: string, operations: BatchOperation[]): Promise<BatchResult> => {
      const res = await client.request<BatchResult>("POST", client.dbPath(`/collections/${collection}/records/batch`), operations);
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
      const path = client.dbPath(`/collections/${collection}/records`) + (qs ? `?${qs}` : "");
      const res = await client.request<BoltstoreRecord[]>("GET", path);
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
        const result = await client.records.paginate(collection, { ...options, page, perPage });
        all.push(...result.data);
        if (page >= result.meta.total_pages) break;
        if (page >= maxPages) throw new BoltstoreError(400, "TOO_MANY_PAGES", `listAll stopped after ${maxPages} pages.`);
        page++;
      }

      return all;
    },
  };
}
