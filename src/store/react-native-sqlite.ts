import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const _rnSqlite = "react-native-sqlite-storage";

async function loadRNSqlite(): Promise<any> {
  try {
    return await import(_rnSqlite);
  } catch {
    throw new Error(
      "@boltstore/client: ReactNativeSqliteStore requires react-native-sqlite-storage. " +
      "Install it with: npm install react-native-sqlite-storage"
    );
  }
}

export class ReactNativeSqliteStore implements LocalStore {
  private db: any = null;
  private tables = new Set<string>();
  private dbName: string;
  private ready: Promise<void>;

  constructor(dbName?: string) {
    this.dbName = dbName ?? "boltstore.db";
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const RN = await loadRNSqlite();
    this.db = await RN.openDatabase({ name: this.dbName, location: "default" });
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private async ensureTable(collection: string): Promise<void> {
    if (this.tables.has(collection)) return;
    this.tables.add(collection);
    const name = this.sanitizeName(collection);
    await this.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }

  private sanitizeName(collection: string): string {
    return `"${collection.replace(/"/g, '""')}"`;
  }

  private exec(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.executeSql(sql, params, () => resolve(), (err: any) => reject(err));
    });
  }

  private all(sql: string, params: any[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db.executeSql(
        sql,
        params,
        (result: any) => {
          const rows: Record<string, unknown>[] = [];
          for (let i = 0; i < result.rows.length; i++) {
            rows.push(JSON.parse(result.rows.item(i).data));
          }
          resolve(rows);
        },
        (err: any) => reject(err)
      );
    });
  }

  private async allFromTable(collection: string): Promise<Record<string, unknown>[]> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    return this.all(`SELECT id, data FROM ${t}`);
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      await this.exec(`INSERT OR REPLACE INTO ${t} (id, data) VALUES (?, ?)`, [id, JSON.stringify({ ...rec, id })]);
    }
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.get(collection, id);
    await this.insert(collection, [{ ...(existing ?? {}), ...data, id }]);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);
    await this.exec(`DELETE FROM ${t} WHERE id = ?`, [id]);
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
    const sql = `SELECT data FROM ${t} WHERE id = ?`;
    return new Promise((resolve, reject) => {
      this.db.executeSql(
        sql,
        [id],
        (result: any) => {
          if (result.rows.length === 0) return resolve(null);
          resolve(JSON.parse(result.rows.item(0).data));
        },
        (err: any) => reject(err)
      );
    });
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    await this.ensureTable(collection);
    const t = this.sanitizeName(collection);

    if (!filter || Object.keys(filter).length === 0) {
      return new Promise((resolve, reject) => {
        this.db.executeSql(
          `SELECT COUNT(*) as c FROM ${t}`,
          [],
          (result: any) => resolve(result.rows.item(0).c),
          (err: any) => reject(err)
        );
      });
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
      this.db.close();
      this.db = null;
    }
  }
}
