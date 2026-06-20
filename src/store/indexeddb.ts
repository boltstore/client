import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const DB_NAME = "boltstore";
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Drop old per-collection stores from v1 schema (prefixed with col_)
      for (let i = 0; i < db.objectStoreNames.length; i++) {
        const name = db.objectStoreNames[i];
        if (name.startsWith("col_") || name === "col_") {
          db.deleteObjectStore(name);
        }
      }
      // Create the new single records store if not present
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: ["collection", "id"] });
        store.createIndex("collection", "collection", { unique: false });
      }
      if (!db.objectStoreNames.contains("_meta")) {
        db.createObjectStore("_meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function recordKey(collection: string, id: string): [string, string] {
  return [collection, id];
}

/** Open a readwrite transaction on the records store. */
function recordsStore(db: IDBDatabase, mode: IDBTransactionMode = "readwrite"): IDBObjectStore {
  return db.transaction("records", mode).objectStore("records");
}

/** Get all records for a collection by iterating the collection index. */
function getAllForCollection(db: IDBDatabase, collection: string): Promise<Record<string, unknown>[]> {
  const store = db.transaction("records", "readonly").objectStore("records");
  const index = store.index("collection");
  return new Promise((resolve, reject) => {
    const req = index.getAll(collection);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbStore implements LocalStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB();
    }
    return this.dbPromise;
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    const database = await this.db();
    const store = recordsStore(database, "readwrite");
    return new Promise((resolve, reject) => {
      const tx = store.transaction;
      for (const rec of records) {
        const id = (rec.id as string) ?? crypto.randomUUID();
        store.put({ collection, id, ...rec });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.get(collection, id);
    const merged = { ...(existing ?? {}), ...data, id };
    await this.insert(collection, [merged]);
  }

  async delete(collection: string, id: string): Promise<void> {
    const database = await this.db();
    const store = recordsStore(database, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(recordKey(collection, id));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const database = await this.db();
    let results = await getAllForCollection(database, collection);
    if (filter && Object.keys(filter).length > 0) {
      for (const [key, value] of Object.entries(filter)) {
        results = results.filter((r) => r[key] === value);
      }
    }
    results = applySort(results, options?.sort, options?.direction);
    if (options?.offset) results = results.slice(options.offset);
    if (options?.limit != null) results = results.slice(0, options.limit);
    return results;
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const database = await this.db();
    const store = database.transaction("records", "readonly").objectStore("records");
    return new Promise((resolve, reject) => {
      const req = store.get(recordKey(collection, id));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const database = await this.db();
    const results = await getAllForCollection(database, collection);
    if (!filter || Object.keys(filter).length === 0) return results.length;
    let count = 0;
    for (const rec of results) {
      let match = true;
      for (const [key, value] of Object.entries(filter)) {
        if (rec[key] !== value) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }

  async distinct(collection: string, field: string): Promise<unknown[]> {
    const database = await this.db();
    const results = await getAllForCollection(database, collection);
    const values = new Set<unknown>();
    for (const rec of results) {
      const val = rec[field];
      if (val !== undefined) values.add(val);
    }
    return [...values];
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    const database = await this.db();
    let results = await getAllForCollection(database, options.collection);

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
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}
