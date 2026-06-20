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
  type PaginatedResult,
  type TypedRecord,
  type TypedCollection,
  type PaginateOptions,
  type TokenPair,
  type UserProfile,
  type OAuthProvider,
  type HealthCheck,
  type TypedBatchOperation,
} from "./client";

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
  RecordEvent,
  AggregateSpec,
  AggregateFn,
} from "@boltstore/utils";

export { MemoryStore, IndexedDbStore } from "./store";
export type { LocalStore } from "./store/types";
export { evaluateFilter, matchesSearch } from "./store/filter";