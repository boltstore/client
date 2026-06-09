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
}

export interface RecordListResult {
  items: RecordData[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
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
 */
export async function createRecord(
  client: BoltstoreClient,
  collection: string,
  data: Record<string, unknown>
): Promise<RecordData> {
  const result = await client.post<RecordData>(
    `/api/collections/${collection}/records`,
    data
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
 * Delete a record.
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
