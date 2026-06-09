// ── Collections Module ──
// Read collection schemas from the server.

import type { BoltstoreClient } from "./client";
import type { CollectionSchema } from "@boltstore/shared";

/**
 * List all collections for the current project.
 */
export async function listCollections(
  client: BoltstoreClient
): Promise<CollectionSchema[]> {
  const result = await client.get<CollectionSchema[]>("/api/collections");

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to list collections");
  }

  return result.data;
}

/**
 * Get the schema for a specific collection.
 */
export async function getCollectionSchema(
  client: BoltstoreClient,
  collectionName: string
): Promise<CollectionSchema> {
  const result = await client.get<CollectionSchema>(
    `/api/collections/${collectionName}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Collection not found");
  }

  return result.data;
}

/**
 * Create a new collection (admin).
 */
export async function createCollection(
  client: BoltstoreClient,
  schema: Omit<CollectionSchema, "id" | "created" | "updated">
): Promise<CollectionSchema> {
  const result = await client.post<CollectionSchema>("/api/collections", schema);

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to create collection");
  }

  return result.data;
}

/**
 * Update a collection schema (admin).
 */
export async function updateCollection(
  client: BoltstoreClient,
  name: string,
  schema: Partial<CollectionSchema>
): Promise<CollectionSchema> {
  const result = await client.patch<CollectionSchema>(
    `/api/collections/${name}`,
    schema
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to update collection");
  }

  return result.data;
}

/**
 * Delete a collection (admin).
 */
export async function deleteCollection(
  client: BoltstoreClient,
  name: string
): Promise<void> {
  const result = await client.delete(`/api/collections/${name}`);

  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to delete collection");
  }
}
