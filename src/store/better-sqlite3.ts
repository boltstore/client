import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const _betterSqlite3 = "better-sqlite3";

async function loadBetterSqlite3(): Promise<any> {
  try {
    return await import(_betterSqlite3);
  } catch {
    throw new Error(
      "@boltstore/client: BetterSqlite3Store requires better-sqlite3. " +
      "Install it with: npm install better-sqlite3"
    );
  }
}

export class BetterSqlite3Store implements LocalStore {
  private db: any = null;
  private tables = new Set<string>();
  private filename: string;
  private ready: Promise<void>;

  constructor(filename?: string) {
    this.filename = filename ?? ":memory:";
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const BetterSqlite3 = await loadBetterSqlite3();
    const Database = BetterSqlite3.default || BetterSqlite3;
    this.db = new Database(this.filename);
    this.db.pragma("journal_mode = WAL");
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
    const name = this.sanitizeName(collection);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.tables.add(collection);
  }

  private async all(collection: string): Promise<Record<string, unknown>[]> {
    const t = this.sanitizeName(collection);
    const rows = this.db.prepare(`SELECT id, data FROM ${t}`).all() as Array<{
      id: string;
      data: string;
    }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO ${t} (id, data) VALUES (?, ?)`);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      stmt.run(id, JSON.stringify({ ...rec, id }));
    }
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.ensureTable(collection);
    const existing = await this.get(collection, id);
    await this.insert(collection, [{ ...(existing ?? {}), ...data, id }]);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    this.db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id);
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    await this.ensureTable(collection);
    let results = await this.all(collection);

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
    const row = this.db.prepare(`SELECT data FROM ${t} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);

    if (!filter || Object.keys(filter).length === 0) {
      const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
      return row.c;
    }

    const rows = await this.all(collection);
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
    await this.ensureTable(collection);
    const rows = await this.all(collection);
    const values = new Set<unknown>();
    for (const rec of rows) {
      const val = rec[field];
      if (val !== undefined) values.add(val);
    }
    return [...values];
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    await this.ensureTable(options.collection);
    let results = await this.all(options.collection);

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
      this.db.close();
      this.db = null;
    }
  }
}
