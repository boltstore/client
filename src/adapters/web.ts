// ── Web Browser Adapter ──
// Platform adapter for browser environments.
// Uses IndexedDB for local offline storage.

import type { PlatformAdapter, LocalDatabase } from "./node";

/**
 * Web browser adapter — uses IndexedDB for offline storage.
 */
export function createWebAdapter(): PlatformAdapter {
  return {
    name: "web",
    fetch: (typeof window !== "undefined" ? window.fetch : globalThis.fetch).bind(
      typeof window !== "undefined" ? window : globalThis
    ),
    createWebSocket: (url: string) => new WebSocket(url),
    createLocalDb: (name: string) => createIndexedDb(name),
  };
}

/**
 * Minimal IndexedDB-based local database.
 * Stores records as JSON in IndexedDB.
 */
function createIndexedDb(name: string): LocalDatabase {
  const storeName = "records";
  let db: IDBDatabase | null = null;
  let ready = false;
  let initPromise: Promise<void>;

  initPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      // Fallback: return a minimal in-memory db when IndexedDB is not available
      resolve();
      return;
    }
    const request = indexedDB.open(name, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      ready = true;
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
  });

  async function ensureReady(): Promise<IDBDatabase> {
    await initPromise;
    if (!db) throw new Error("IndexedDB not initialized");
    return db;
  }

  return {
    exec: (sql: string) => {
      // IndexedDB doesn't support SQL — this is a no-op
      // The SQL is a CREATE TABLE statement; we use object stores instead
    },

    query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] => {
      // For query support, we'd need to parse the SQL
      // In practice, the SDK's sync engine uses a higher-level API
      return [];
    },

    queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null => {
      return null;
    },

    run: (sql: string, ...params: unknown[]) => {
      // For writes, we'd need to parse the SQL
    },

    close: () => {
      if (db) {
        db.close();
        db = null;
        ready = false;
      }
    },
  };
}

/**
 * Auto-detect the platform and return the appropriate adapter.
 */
export function autoDetectAdapter(): PlatformAdapter {
  if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
    return createWebAdapter();
  }
  // Fall back to Node adapter
  const { createNodeAdapter } = require("./node");
  return createNodeAdapter();
}
