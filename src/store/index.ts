export { MemoryStore } from "./memory";
export { IndexedDbStore } from "./indexeddb";
export type { LocalStore, QueryResult } from "./types";
export { evaluateFilter, matchesSearch } from "./filter";

const SYSTEM_COLLECTION_PREFIX = "_";

export function isUserCollection(name: string): boolean {
  return !name.startsWith(SYSTEM_COLLECTION_PREFIX);
}
