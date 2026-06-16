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
  type ClientConfig,
  type PaginatedResult,
  type TypedRecord,
  type TypedCollection,
  type TypedBatchOperation,
  type PaginateOptions,
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
} from "@boltstore/utils";