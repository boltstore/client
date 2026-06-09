// ── @boltstore/client ──
// TypeScript SDK for Boltstore. Works in Bun, Node 18+, browsers, React Native.
// Zero dependencies beyond @boltstore/shared (types only).

// ── Main Client ──
export { BoltstoreClient } from "./client";
export type { ClientConfig, AuthState, RequestOptions } from "./client";

// ── Auth ──
export {
  login,
  register,
  refreshAuth,
  logout,
  getOAuth2Url,
  handleOAuth2Callback,
  loginWithGoogle,
  loginWithGitHub,
} from "./auth";

// ── Records ──
export {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  getAllRecords,
  batch,
} from "./records";
export type { RecordQuery, RecordListResult } from "./records";

// ── Collections ──
export {
  listCollections,
  getCollectionSchema,
  createCollection,
  updateCollection,
  deleteCollection,
} from "./collections";

// ── Realtime ──
export { connectRealtime, RealtimeClient } from "./realtime";
export type { RealtimeCallback, Subscription } from "./realtime";

// ── Sync ──
export { enableSync, SyncEngine } from "./sync";
export type { SyncOptions } from "./sync";

// ── Storage ──
export {
  uploadFile,
  downloadFile,
  getFileUrl,
  getSignedUrl,
  deleteFile,
} from "./storage";

// ── Adapters ──
export { createNodeAdapter } from "./adapters/node";
export { createWebAdapter, autoDetectAdapter } from "./adapters/web";
export { createReactNativeAdapter } from "./adapters/react-native";
export type { PlatformAdapter } from "./adapters/node";

// ── Re-export shared types for convenience ──
export type {
  RecordData,
  CollectionSchema,
  FieldSchema,
  BoltstoreUser,
  BoltstoreProject,
  ApiResponse,
  PaginatedResponse,
  BatchOperation,
  BatchResult,
} from "@boltstore/shared";

export type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RefreshResponse,
  JwtPayload,
} from "@boltstore/shared/auth-types";

export type {
  VersionVector,
  LamportClock,
  ChangeLogEntry,
  MergeResult,
  ClientSyncState,
  SyncConnectionState,
} from "@boltstore/shared/sync-types";

export type {
  FileInfo,
  UploadRequest,
  UploadResponse,
} from "@boltstore/shared/storage-types";
