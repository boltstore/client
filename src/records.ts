// ── Records Module ──
// CRUD operations for collection records.

import type { BoltstoreClient } from "./client";
import type { RecordData, PaginationParams } from "@boltstore/shared";

// ── Query interface ──

export interface RecordQuery extends PaginationParams {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  expand?: string;
  search?: string;
  fields?: string;
  cursor?: string;
  includeDeleted?: boolean;
  upsert?: boolean;
}

export interface RecordListResult {
  items: RecordData[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  hasNextPage?: boolean;
  nextCursor?: string;
}

// ── Batch Operations ──

import type { BatchOperation, BatchResult } from "@boltstore/shared";

/**
 * Execute multiple record operations in a single request.
 *
 * @example
 * const result = await batch(client, [
 *   { method: "POST", collection: "todos", data: { title: "A" } },
 *   { method: "POST", collection: "todos", data: { title: "B" } },
 *   { method: "PATCH", collection: "todos", id: "existing-id", data: { done: true } },
 *   { method: "DELETE", collection: "todos", id: "old-id" },
 * ]);
 */
export async function batch(
  client: BoltstoreClient,
  operations: BatchOperation[],
  options?: { transactional?: boolean }
): Promise<BatchResult["results"]> {
  const result = await client.post<BatchResult>("/api/batch", {
    operations,
    transactional: options?.transactional ?? false,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Batch operation failed");
  }

  return result.data.results;
}

// ── Aggregate ──

export interface AggregateQuery {
  groupBy?: string | string[];
  aggregate?: "count" | "sum" | "avg" | "min" | "max";
  aggregateField?: string;
  filter?: string;
  sort?: string;
  limit?: number;
}

export interface AggregateResult {
  items: Record<string, unknown>[];
  groupBy: string[];
  aggregate?: string;
  total?: number;
}

/**
 * Aggregate records (GROUP BY / COUNT / SUM / AVG / MIN / MAX).
 *
 * @example
 * const result = await aggregateRecords(client, "jobs", {
 *   groupBy: "company",
 *   aggregate: "count",
 *   sort: "-total",
 * });
 */
export async function aggregateRecords(
  client: BoltstoreClient,
  collection: string,
  query?: AggregateQuery
): Promise<AggregateResult> {
  const params: Record<string, string> = {};

  if (query?.groupBy) {
    params.groupBy = Array.isArray(query.groupBy)
      ? query.groupBy.join(",")
      : query.groupBy;
  }
  if (query?.aggregate) params.aggregate = query.aggregate;
  if (query?.aggregateField) params.aggregateField = query.aggregateField;
  if (query?.filter) params.filter = query.filter;
  if (query?.sort) params.sort = query.sort;
  if (query?.limit) params.limit = String(query.limit);

  const result = await client.get<AggregateResult>(
    `/api/collections/${collection}/aggregate`,
    params
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to aggregate records");
  }

  return result.data;
}

/**
 * Bulk create multiple records in a single request.
 * Uses the bulk array endpoint (more efficient than batch API).
 *
 * @example
 * const created = await bulkCreateRecords(client, "todos", [
 *   { title: "A" },
 *   { title: "B" },
 * ]);
 */
export async function bulkCreateRecords(
  client: BoltstoreClient,
  collection: string,
  records: Record<string, unknown>[]
): Promise<RecordData[]> {
  const result = await client.post<RecordData[]>(
    `/api/collections/${collection}/records`,
    records
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to bulk create records");
  }

  return result.data;
}

// ── CRUD Operations ──

/**
 * List records in a collection with optional filtering, sorting, and pagination.
 *
 * @example
 * const todos = await listRecords(client, "todos", {
 *   filter: "status = 'active' && priority > 2",
 *   sort: "-created",
 *   perPage: 50,
 * });
 */
export async function listRecords(
  client: BoltstoreClient,
  collection: string,
  query?: RecordQuery
): Promise<RecordListResult> {
  const params: Record<string, string | undefined> = {};

  if (query?.filter) params.filter = query.filter;
  if (query?.sort) params.sort = query.sort;
  if (query?.page) params.page = String(query.page);
  if (query?.perPage) params.perPage = String(query.perPage);
  if (query?.expand) params.expand = query.expand;
  if (query?.search) params.search = query.search;
  if (query?.fields) params.fields = query.fields;
  if (query?.cursor) params.cursor = query.cursor;
  if (query?.includeDeleted !== undefined) params.includeDeleted = String(query.includeDeleted);

  const result = await client.get<RecordListResult>(
    `/api/collections/${collection}/records`,
    params
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to list records");
  }

  return result.data;
}

/**
 * Get a single record by ID.
 */
export async function getRecord(
  client: BoltstoreClient,
  collection: string,
  id: string
): Promise<RecordData> {
  const result = await client.get<RecordData>(
    `/api/collections/${collection}/records/${id}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Record not found");
  }

  return result.data;
}

/**
 * Create a new record in a collection.
 * 
 * @example
 * // Create with upsert
 * const record = await createRecord(client, "todos", 
 *   { id: "existing-id", title: "Updated" },
 *   { upsert: true }
 * );
 */
export async function createRecord(
  client: BoltstoreClient,
  collection: string,
  data: Record<string, unknown>,
  options?: { upsert?: boolean }
): Promise<RecordData> {
  const body: Record<string, unknown> = { ...data };
  if (options?.upsert) {
    body._upsert = true;
  }
  const result = await client.post<RecordData>(
    `/api/collections/${collection}/records`,
    body
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to create record");
  }

  return result.data;
}

/**
 * Update an existing record (partial update).
 */
export async function updateRecord(
  client: BoltstoreClient,
  collection: string,
  id: string,
  data: Record<string, unknown>
): Promise<RecordData> {
  const result = await client.patch<RecordData>(
    `/api/collections/${collection}/records/${id}`,
    data
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to update record");
  }

  return result.data;
}

/**
 * Delete a record. Soft-delete is handled transparently by the server.
 */
export async function deleteRecord(
  client: BoltstoreClient,
  collection: string,
  id: string
): Promise<void> {
  const result = await client.delete(
    `/api/collections/${collection}/records/${id}`
  );

  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to delete record");
  }
}

/**
 * Recover a soft-deleted record (admin only).
 * Calls POST /api/collections/{collection}/records/{id}/recover
 */
export async function recoverRecord(
  client: BoltstoreClient,
  collection: string,
  id: string
): Promise<RecordData> {
  const result = await client.post<RecordData>(
    `/api/collections/${collection}/records/${id}/recover`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to recover record");
  }

  return result.data;
}

/**
 * Get all records (auto-paginates through all pages).
 * Use with caution on large collections.
 */
export async function getAllRecords(
  client: BoltstoreClient,
  collection: string,
  query?: Omit<RecordQuery, "page" | "perPage">
): Promise<RecordData[]> {
  const allItems: RecordData[] = [];
  let page = 1;
  const perPage = 200; // Max per page

  while (true) {
    const result = await listRecords(client, collection, {
      ...query,
      page,
      perPage,
    });

    allItems.push(...result.items);

    if (page >= result.totalPages) break;
    page++;
  }

  return allItems;
}
