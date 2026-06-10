// ── Storage Module ──
// File upload, download, and presigned URL operations.

import type { BoltstoreClient } from "./client";
import type { UploadResponse, FileInfo } from "@boltstore/shared";

/**
 * Upload a file to Boltstore.
 *
 * @example
 * const file = await uploadFile(client, {
 *   file: imageFile,
 *   applicationId: "proj_123",
 *   collection: "photos",
 *   recordId: "rec_abc",
 *   field: "image",
 * });
 *
 * @example
 * // Upload to a specific folder in the file browser
 * const file = await uploadFile(client, imageFile, {
 *   applicationId: "proj_123",
 *   folder: "avatars",
 *   filename: "photo.png",
 * });
 */
export async function uploadFile(
  client: BoltstoreClient,
  file: File | Blob,
  options: {
    applicationId: string;
    collection?: string;
    recordId?: string;
    field?: string;
    folder?: string;
    filename?: string;
  }
): Promise<UploadResponse> {
  // Note: React Native uses its own File/FormData implementation.
  // Ensure the platform polyfills these globals before calling uploadFile.
  const baseUrl = (client as any).config?.url ?? "";
  const token = (client as any).authState?.token;

  const queryParams = new URLSearchParams();
  queryParams.set("application", options.applicationId);
  if (options.folder) queryParams.set("folder", options.folder);
  if (options.collection) queryParams.set("collection", options.collection);
  if (options.recordId) queryParams.set("recordId", options.recordId);
  if (options.field) queryParams.set("field", options.field);
  const url = `${baseUrl}/api/files/upload?${queryParams.toString()}`;

  const formData = new FormData();
  formData.append("file", file, options.filename ?? (file as File).name ?? "upload");

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await client.fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message ?? "Upload failed");
  }

  return result.data as UploadResponse;
}

/**
 * Get a download URL for a file.
 */
export function getFileUrl(client: BoltstoreClient, key: string): string {
  const baseUrl = (client as any).config?.url ?? "";
  return `${baseUrl}/api/files/${encodeURIComponent(key)}`;
}

/**
 * Download a file as a Blob.
 */
export async function downloadFile(
  client: BoltstoreClient,
  key: string
): Promise<Blob> {
  const baseUrl = (client as any).config?.url ?? "";
  const token = (client as any).authState?.token;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}/api/files/${encodeURIComponent(key)}`, { headers });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  return response.blob();
}

/**
 * Get a presigned URL for direct file access.
 */
export async function getSignedUrl(
  client: BoltstoreClient,
  key: string,
  options?: { expiry?: number; download?: boolean }
): Promise<string> {
  const params = new URLSearchParams();
  if (options?.expiry) params.set("expiry", String(options.expiry));
  if (options?.download) params.set("download", "true");

  const result = await client.get<{ url: string }>(
    `/api/files/${encodeURIComponent(key)}/signed-url?${params.toString()}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to get signed URL");
  }

  return result.data.url;
}

/**
 * List files for the current application.
 * Requires X-Application-Id to be set on the client.
 */
export async function listFiles(
  client: BoltstoreClient
): Promise<FileInfo[]> {
  const result = await client.get<{ files: FileInfo[]; folders: string[] }>(`/api/files`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to list files");
  }
  return result.data.files;
}

/**
 * Delete a file.
 */
export async function deleteFile(
  client: BoltstoreClient,
  key: string
): Promise<void> {
  const result = await client.delete(`/api/files/${encodeURIComponent(key)}`);
  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to delete file");
  }
}

/**
 * Get metadata for a single file.
 */
export async function getFileInfo(
  client: BoltstoreClient,
  key: string
): Promise<FileInfo> {
  const result = await client.get<{ file: FileInfo }>(`/api/files/${encodeURIComponent(key)}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to get file info");
  }
  return result.data.file;
}

/**
 * Update a file's metadata.
 */
export async function updateFile(
  client: BoltstoreClient,
  key: string,
  metadata: Partial<FileInfo>
): Promise<FileInfo> {
  const result = await client.patch<{ file: FileInfo }>(`/api/files/${encodeURIComponent(key)}`, metadata);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to update file");
  }
  return result.data.file;
}

/**
 * Create a new folder.
 */
export async function createFolder(
  client: BoltstoreClient,
  options: {
    applicationId: string;
    name: string;
    path?: string;
    parent?: string;
  }
): Promise<{ id: string; name: string; path: string }> {
  const result = await client.post<{ folder: { id: string; name: string; path: string } }>("/api/files/folders", options);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to create folder");
  }
  return result.data.folder;
}

/**
 * Get folder configuration.
 */
export async function getFolderConfig(
  client: BoltstoreClient,
  folderId: string
): Promise<{ id: string; name: string; path: string; permissions?: Record<string, unknown> }> {
  const result = await client.get<{ folder: { id: string; name: string; path: string; permissions?: Record<string, unknown> } }>(`/api/files/folders/${encodeURIComponent(folderId)}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to get folder config");
  }
  return result.data.folder;
}

/**
 * Update folder configuration.
 */
export async function updateFolderConfig(
  client: BoltstoreClient,
  folderId: string,
  config: { name?: string; permissions?: Record<string, unknown> }
): Promise<{ id: string; name: string; path: string }> {
  const result = await client.patch<{ folder: { id: string; name: string; path: string } }>(`/api/files/folders/${encodeURIComponent(folderId)}`, config);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? "Failed to update folder config");
  }
  return result.data.folder;
}

/**
 * Delete a folder.
 */
export async function deleteFolder(
  client: BoltstoreClient,
  folderId: string
): Promise<void> {
  const result = await client.delete(`/api/files/folders/${encodeURIComponent(folderId)}`);
  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to delete folder");
  }
}
