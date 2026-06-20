import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const _fs = "fs", _path = "path";

async function loadFs(): Promise<{ fs: any; path: any }> {
  try {
    const [fsMod, pathMod] = await Promise.all([
      import(_fs) as Promise<any>,
      import(_path) as Promise<any>,
    ]);
    return { fs: fsMod.default || fsMod, path: pathMod.default || pathMod };
  } catch {
    throw new Error(
      "@boltstore/client: NodeFileStore requires Node.js. " +
      "On other platforms use MemoryStore, IndexedDbStore, or BunSqliteStore."
    );
  }
}

export class NodeFileStore implements LocalStore {
  private dir: string;
  private fs!: any;
  private path!: any;
  private ready: Promise<void>;

  private cache = new Map<string, Map<string, Record<string, unknown>>>();
  private loaded = new Set<string>();

  constructor(dir?: string) {
    this.dir = dir ?? ".boltstore";
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const mods = await loadFs();
    this.fs = mods.fs;
    this.path = mods.path;
    this.fs.mkdirSync(this.dir, { recursive: true });
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private collectionPath(collection: string): string {
    return this.path.join(this.dir, `${collection}.json`);
  }

  private async loadCollection(collection: string): Promise<void> {
    await this.ensureReady();
    if (this.loaded.has(collection)) return;
    this.loaded.add(collection);

    const map = new Map<string, Record<string, unknown>>();
    try {
      const content = this.fs.readFileSync(this.collectionPath(collection), "utf-8");
      const data = JSON.parse(content);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [id, record] of Object.entries(data)) {
          map.set(id, record as Record<string, unknown>);
        }
      }
    } catch {
      // File doesn't exist yet — start with empty collection
    }
    this.cache.set(collection, map);
  }

  private async flushCollection(collection: string): Promise<void> {
    await this.ensureReady();
    const map = this.cache.get(collection);
    if (!map) return;

    const obj: Record<string, unknown> = {};
    for (const [id, record] of map) {
      obj[id] = record;
    }
    this.fs.writeFileSync(this.collectionPath(collection), JSON.stringify(obj), "utf-8");
  }

  private async getMap(collection: string): Promise<Map<string, Record<string, unknown>>> {
    await this.loadCollection(collection);
    return this.cache.get(collection)!;
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    const map = await this.getMap(collection);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      map.set(id, { ...rec, id });
    }
    await this.flushCollection(collection);
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const map = await this.getMap(collection);
    const existing = map.get(id);
    map.set(id, { ...(existing ?? {}), ...data, id });
    await this.flushCollection(collection);
  }

  async delete(collection: string, id: string): Promise<void> {
    const map = await this.getMap(collection);
    map.delete(id);
    await this.flushCollection(collection);
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const map = await this.getMap(collection);
    let results = [...map.values()];

    if (filter && Object.keys(filter).length > 0) {
      results = results.filter((r) => {
        for (const [key, value] of Object.entries(filter)) {
          if (r[key] !== value) return false;
        }
        return true;
      });
    }

    results = applySort(results, options?.sort, options?.direction);

    if (options?.offset) results = results.slice(options.offset);
    if (options?.limit != null) results = results.slice(0, options.limit);

    return results;
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const map = await this.getMap(collection);
    return map.get(id) ?? null;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const map = await this.getMap(collection);
    if (!filter || Object.keys(filter).length === 0) return map.size;

    let count = 0;
    for (const rec of map.values()) {
      let match = true;
      for (const [key, value] of Object.entries(filter)) {
        if (rec[key] !== value) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }

  async distinct(collection: string, field: string): Promise<unknown[]> {
    const map = await this.getMap(collection);
    const values = new Set<unknown>();
    for (const rec of map.values()) {
      const val = rec[field];
      if (val !== undefined) values.add(val);
    }
    return [...values];
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    const map = await this.getMap(options.collection);
    let results = [...map.values()];

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

    return { data: results, meta: { total } };
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
    this.cache.clear();
    this.loaded.clear();
  }
}
