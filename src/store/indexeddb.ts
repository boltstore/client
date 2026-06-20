import type { QueryOptions } from "@boltstore/utils";
import type { LocalStore, QueryResult } from "./types";
import { evaluateFilter, matchesSearch, applySort } from "./filter";

const DB_NAME = "boltstore";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("_meta")) {
        db.createObjectStore("_meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function getStoreName(collection: string): string {
  return `col_${collection}`;
}

function ensureStore(db: IDBDatabase, collection: string): IDBObjectStore {
  const name = getStoreName(collection);
  if (!db.objectStoreNames.contains(name)) {
    db.close();
    throw new Error(`Store "${name}" does not exist. Call ensureCollection first.`);
  }
  return db.transaction(name, "readwrite").objectStore(name);
}

let _currentVersion = DB_VERSION;

async function ensureCollection(collection: string): Promise<void> {
  const name = getStoreName(collection);
  const req = indexedDB.open(DB_NAME, _currentVersion + 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    _currentVersion = db.version;
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("_meta")) {
      db.createObjectStore("_meta", { keyPath: "key" });
    }
  };
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      reject(new Error(`Version upgrade blocked for store "${name}". Close other tabs.`));
    };
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

  private async getStore(
    collection: string,
    mode: IDBTransactionMode = "readwrite"
  ): Promise<IDBObjectStore> {
    const db = await this.db();
    const name = getStoreName(collection);
    if (!db.objectStoreNames.contains(name)) {
      await ensureCollection(collection);
      this.dbPromise = null;
      return this.getStore(collection, mode);
    }
    return db.transaction(name, mode).objectStore(name);
  }

  async insert(collection: string, records: Record<string, unknown>[]): Promise<void> {
    await ensureCollection(collection);
    const store = await this.getStore(collection);
    for (const rec of records) {
      const id = (rec.id as string) ?? crypto.randomUUID();
      store.put({ ...rec, id });
    }
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    await ensureCollection(collection);
    const store = await this.getStore(collection);
    const existing = await this.get(collection, id);
    store.put({ ...(existing ?? {}), ...data, id });
  }

  async delete(collection: string, id: string): Promise<void> {
    await ensureCollection(collection);
    const store = await this.getStore(collection);
    store.delete(id);
  }

  async find(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    await ensureCollection(collection);
    const store = await this.getStore(collection, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let results = req.result;
        if (filter && Object.keys(filter).length > 0) {
          for (const [key, value] of Object.entries(filter)) {
            results = results.filter((r) => r[key] === value);
          }
        }
        results = applySort(results, options?.sort, options?.direction);
        if (options?.offset) results = results.slice(options.offset);
        if (options?.limit != null) results = results.slice(0, options.limit);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    await ensureCollection(collection);
    const store = await this.getStore(collection, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    await ensureCollection(collection);
    const store = await this.getStore(collection, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => {
        if (!filter || Object.keys(filter).length === 0) {
          resolve(req.result);
        } else {
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            let count = 0;
            for (const rec of allReq.result) {
              let match = true;
              for (const [key, value] of Object.entries(filter)) {
                if (rec[key] !== value) { match = false; break; }
              }
              if (match) count++;
            }
            resolve(count);
          };
          allReq.onerror = () => reject(allReq.error);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async distinct(collection: string, field: string): Promise<unknown[]> {
    await ensureCollection(collection);
    const store = await this.getStore(collection, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const values = new Set<unknown>();
        for (const rec of req.result) {
          const val = rec[field];
          if (val !== undefined) values.add(val);
        }
        resolve([...values]);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    await ensureCollection(options.collection);
    const store = await this.getStore(options.collection, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let results = req.result;

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

        resolve({ data: results, meta: { total } });
      };
      req.onerror = () => reject(req.error);
    });
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
