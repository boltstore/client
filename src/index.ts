/**
 * @boltstore/client — JavaScript/TypeScript SDK for Boltstore.
 *
 * Zero-dependency client for browser, Node.js, React Native, and Deno.
 * Provides type-safe access to Boltstore's non-admin REST API.
 *
 * @module @boltstore/client
 */

export {
  BoltstoreClient,
  BoltstoreError,
  TypedCollectionImpl,
  type ClientConfig,
  type PaginatedResult,
  type TypedRecord,
  type TypedCollection,
  type PaginateOptions,
  type TokenPair,
  type UserProfile,
  type OAuthProvider,
  type HealthCheck,
} from "./client";

export type { TypedBatchOperation } from "./types";

export type {
  ApiResponse,
  CollectionInfo,
  DatabaseInfo,
  BoltstoreRecord,
  ColumnDefinition,
  ColumnType,
  ListOptions,
  BatchOperation,
  BatchResult,
  QueryOptions,
  Filter,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  SortSpec,
  PaginationMeta,
  WsClientConfig,
  ConnectionState,
  ReconnectConfig,
  SubscriptionState,
  RecordEvent,
} from "@boltstore/utils";

export { Realtime, type SubscribeOptions, type SubscribeCallback } from "./ws/realtime";

export { SyncManager, type SyncConfig } from "./sync";
export { InMemoryStore, createWebStore, createFileStore, type SyncStore } from "./sync";
export type {
  SyncStatus,
  SyncPullResult,
  SyncPushResult,
  SyncChange,
  SyncPushOperation,
  SyncPushOperationResult,
  SyncConflict,
} from "./sync";

export { MemoryStore, IndexedDbStore, BunSqliteStore, NodeFileStore, BetterSqlite3Store, ReactNativeSqliteStore, ExpoSqliteStore } from "./store";
export type { LocalStore } from "./store/types";
export { evaluateFilter, matchesSearch } from "./store/filter";