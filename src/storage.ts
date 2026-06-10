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

  const response = await fetch(url, {
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
