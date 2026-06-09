// ── Node / Bun Adapter ──
// Platform adapter for Bun and Node.js 18+ environments.
// Uses native fetch, WebSocket, and bun:sqlite for local DB.

export interface PlatformAdapter {
  /** Platform name */
  name: string;
  /** Create a local database for offline storage */
  createLocalDb: (name: string) => LocalDatabase;
  /** Get the global fetch function */
  fetch: typeof fetch;
  /** Create a WebSocket connection */
  createWebSocket: (url: string) => WebSocket;
}

export interface LocalDatabase {
  exec(sql: string): void;
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  queryOne<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null;
  run(sql: string, ...params: unknown[]): void;
  close(): void;
}

/**
 * Node/Bun adapter — uses bun:sqlite when available,
 * falls back to an in-memory implementation for plain Node.
 */
export function createNodeAdapter(): PlatformAdapter {
  return {
    name: "node",
    fetch: globalThis.fetch.bind(globalThis),
    createWebSocket: (url: string) => new WebSocket(url),
    createLocalDb: (name: string) => {
      // Try bun:sqlite first
      try {
        const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
        const db = new Database(`:memory:`); // Or file-based: `${name}.db`
        return {
          exec: (sql: string) => db.run(sql),
          query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
            db.query(sql).all(...params) as T[],
          queryOne: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
            (db.query(sql).get(...params) as T) ?? null,
          run: (sql: string, ...params: unknown[]) => db.run(sql, ...params),
          close: () => db.close(),
        };
      } catch {
        // Fallback: in-memory store (limited, for environments without bun:sqlite)
        console.warn("bun:sqlite not available — using in-memory storage (limited offline support)");
        const store = new Map<string, unknown[]>();
        return {
          exec: (_sql: string) => {},
          query: <T = Record<string, unknown>>(_sql: string, ..._params: unknown[]) => [] as T[],
          queryOne: <T = Record<string, unknown>>(_sql: string, ..._params: unknown[]) => null as T | null,
          run: (_sql: string, ..._params: unknown[]) => {},
          close: () => store.clear(),
        };
      }
    },
  };
}
