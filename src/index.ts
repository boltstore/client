/**
 * @boltstore/client — JavaScript/TypeScript SDK for Boltstore.
 *
 * Browser-first client with automatic offline sync and realtime subscriptions.
 *
 * @module @boltstore/client
 */

export {
  BoltstoreClient,
  BoltstoreError,
  type ClientConfig,
  type TypedRecord,
  type TypedCollection,
  type TokenPair,
  type UserProfile,
  type OAuthProvider,
  type HealthCheck,
  type TypedBatchOperation,
} from "./client";

export { ClientQueryBuilder } from "./query-builder";
export type { PaginatedResult } from "./query-builder";

export type {
  ApiResponse,
  CollectionInfo,
  DatabaseInfo,
  BoltstoreRecord,
  ColumnDefinition,
  ColumnType,
  BatchOperation,
  BatchResult,
  RecordEvent,
} from "@boltstore/utils";

export { QueryBuilder } from "@boltstore/utils";

export { MemoryStore, IndexedDbStore } from "./store";
export type { LocalStore } from "./store/types";
export { evaluateFilter, matchesSearch } from "./store/filter";