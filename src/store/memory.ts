import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, evaluateSimpleFilter, matchesSearch, applySort } from "./filter";

export class MemoryStore implements LocalStore {
  private data = new Map<string, Map<string, Record<string, unknown>>>();

  private getCollection(collection: string): Map<string, Record<string, unknown>> {
    let store = this.data.get(collection);
    if (!store) {
      store = new Map();
      this.data.set(collection, store);
    }
    return store;
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    const store = this.getCollection(collection);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      store.set(id, { ...rec, id });
    }
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const store = this.getCollection(collection);
    const existing = store.get(id);
    if (existing) {
      store.set(id, { ...existing, ...data, id });
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    this.getCollection(collection).delete(id);
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const store = this.getCollection(collection);
    let results = [...store.values()];

    if (filter && Object.keys(filter).length > 0) {
      results = results.filter((r) => evaluateSimpleFilter(r, filter));
    }

    results = applySort(results, options?.sort, options?.direction);

    if (options?.offset) results = results.slice(options.offset);
    if (options?.limit != null) results = results.slice(0, options.limit);

    return results;
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    return this.getCollection(collection).get(id) ?? null;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const store = this.getCollection(collection);
    if (!filter || Object.keys(filter).length === 0) return store.size;

    let count = 0;
    for (const rec of store.values()) {
      if (evaluateSimpleFilter(rec, filter)) count++;
    }
    return count;
  }

  async distinct(collection: string, field: string): Promise<unknown[]> {
    const store = this.getCollection(collection);
    const values = new Set<unknown>();
    for (const rec of store.values()) {
      const val = rec[field];
      if (val !== undefined) values.add(val);
    }
    return [...values];
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    const store = this.getCollection(options.collection);
    let results = [...store.values()];

    if (options.filter) {
      results = results.filter((r) => evaluateFilter(r, options.filter!));
    }

    if (options.search) {
      results = results.filter((r) => matchesSearch(r, options.search!, options.searchFields));
    }

    results = applySort(results, options.sort);

    const total = results.length;

    if (options.offset) results = results.slice(options.offset);
    if (options.limit != null) results = results.slice(0, options.limit);

    if (options.fields) {
      results = results.map((r) => {
        const subset: Record<string, unknown> = {};
        for (const f of options.fields!) {
          if (f in r) subset[f] = r[f];
        }
        return subset;
      });
    }

    return {
      data: results,
      meta: { total },
    };
  }

  async applyChanges(
    collection: string,
    changes: Array<{
      event: "create" | "update" | "delete";
      recordId: string | null;
      record: Record<string, unknown>;
      previous?: Record<string, unknown> | null;
    }>
  ): Promise<void> {
    for (const change of changes) {
      if (change.event === "create" && change.recordId) {
        await this.insert(collection, [{ ...change.record, id: change.recordId }]);
      } else if (change.event === "update" && change.recordId) {
        await this.update(collection, change.recordId, change.record);
      } else if (change.event === "delete" && change.recordId) {
        await this.delete(collection, change.recordId);
      }
    }
  }

  async close(): Promise<void> {
    this.data.clear();
  }
}
