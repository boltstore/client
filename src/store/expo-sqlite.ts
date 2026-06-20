import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const _expoSqlite = "expo-sqlite";

async function loadExpoSqlite(): Promise<any> {
  try {
    return await import(_expoSqlite);
  } catch {
    throw new Error(
      "@boltstore/client: ExpoSqliteStore requires expo-sqlite. " +
      "Install it with: npx expo install expo-sqlite"
    );
  }
}

export class ExpoSqliteStore implements LocalStore {
  private db: any = null;
  private tables = new Set<string>();
  private dbName: string;
  private ready: Promise<void>;

  constructor(dbName?: string) {
    this.dbName = dbName ?? "boltstore.db";
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const SQLite = await loadExpoSqlite();
    this.db = await SQLite.openDatabaseAsync(this.dbName);
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private sanitizeName(collection: string): string {
    return `"${collection.replace(/"/g, '""')}"`;
  }

  private async ensureTable(collection: string): Promise<void> {
    await this.ensureReady();
    if (this.tables.has(collection)) return;
    this.tables.add(collection);
    const name = this.sanitizeName(collection);
    await this.db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`
    );
  }

  private async allFromTable(collection: string): Promise<Record<string, unknown>[]> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    const rows = await this.db.getAllAsync(`SELECT id, data FROM ${t}`) as Array<{
      id: string;
      data: string;
    }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      await this.db.runAsync(
        `INSERT OR REPLACE INTO ${t} (id, data) VALUES (?, ?)`,
        id,
        JSON.stringify({ ...rec, id })
      );
    }
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.get(collection, id);
    await this.insert(collection, [{ ...(existing ?? {}), ...data, id }]);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    await this.db.runAsync(`DELETE FROM ${t} WHERE id = ?`, id);
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    let results = await this.allFromTable(collection);

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
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    const rows = await this.db.getAllAsync(
      `SELECT data FROM ${t} WHERE id = ?`,
      id
    ) as Array<{ data: string }>;
    return rows.length > 0 ? JSON.parse(rows[0].data) : null;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);

    if (!filter || Object.keys(filter).length === 0) {
      const row = await this.db.getFirstAsync(
        `SELECT COUNT(*) as c FROM ${t}`
      ) as { c: number };
      return row.c;
    }

    const rows = await this.allFromTable(collection);
    let count = 0;
    for (const rec of rows) {
      let match = true;
      for (const [key, value] of Object.entries(filter)) {
        if (rec[key] !== value) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }

  async distinct(collection: string, field: string): Promise<unknown[]> {
    const rows = await this.allFromTable(collection);
    const values = new Set<unknown>();
    for (const rec of rows) {
      const val = rec[field];
      if (val !== undefined) values.add(val);
    }
    return [...values];
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    let results = await this.allFromTable(options.collection);

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
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }
}
