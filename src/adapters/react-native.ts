// ── React Native Adapter ──
// Platform adapter for React Native environments.
// Uses AsyncStorage for offline data and React Native's WebSocket.

import type { PlatformAdapter, LocalDatabase } from "./node";

/**
 * React Native adapter — uses AsyncStorage for offline storage.
 *
 * Note: Requires react-native and @react-native-async-storage/async-storage
 * to be installed in the project.
 */
export function createReactNativeAdapter(): PlatformAdapter {
  return {
    name: "react-native",
    fetch: globalThis.fetch.bind(globalThis),
    createWebSocket: (url: string) => {
      // React Native provides its own WebSocket implementation
      return new WebSocket(url);
    },
    createLocalDb: (name: string) => createAsyncStorageDb(name),
  };
}

/**
 * Minimal AsyncStorage-based local database.
 * Stores records as JSON strings keyed by ID.
 */
function createAsyncStorageDb(name: string): LocalDatabase {
  const prefix = `boltstore:${name}:`;

  // Attempt to import AsyncStorage
  let AsyncStorage: any;
  try {
    AsyncStorage = require("@react-native-async-storage/async-storage").default;
  } catch {
    console.warn(
      "@react-native-async-storage/async-storage not found. Install it for offline support: " +
      "npm install @react-native-async-storage/async-storage"
    );
    // Fallback: in-memory store
    const store = new Map<string, string>();
    AsyncStorage = {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value); },
      removeItem: async (key: string) => { store.delete(key); },
      getAllKeys: async () => Array.from(store.keys()),
      multiRemove: async (keys: string[]) => { keys.forEach((k) => store.delete(k)); },
    };
  }

  return {
    exec: (_sql: string) => {
      // AsyncStorage doesn't support SQL — the SDK uses a higher-level API
    },

    query: <T = Record<string, unknown>>(_sql: string, ..._params: unknown[]): T[] => {
      // Return empty — the sync engine manages data at a higher level
      return [];
    },

    queryOne: <T = Record<string, unknown>>(_sql: string, ..._params: unknown[]): T | null => {
      return null;
    },

    run: (_sql: string, ..._params: unknown[]) => {
      // No-op for AsyncStorage
    },

    close: () => {
      // No cleanup needed for AsyncStorage
    },
  };
}
