export { MemoryStore } from "./memory";
export { IndexedDbStore } from "./indexeddb";
export { BunSqliteStore } from "./bun-sqlite";
export { NodeFileStore } from "./node-file";
export { BetterSqlite3Store } from "./better-sqlite3";
export { ReactNativeSqliteStore } from "./react-native-sqlite";
export { ExpoSqliteStore } from "./expo-sqlite";
export type { LocalStore, QueryResult } from "./types";
export { evaluateFilter, matchesSearch } from "./filter";

const SYSTEM_COLLECTION_PREFIX = "_";

export function isUserCollection(name: string): boolean {
  return !name.startsWith(SYSTEM_COLLECTION_PREFIX);
}
