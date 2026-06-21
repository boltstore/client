import type { BatchResult, BoltstoreRecord, RecordEvent } from "@boltstore/utils";
import type { LocalStore } from "./store/types";
import type { ClientQueryBuilder } from "./query-builder";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
}

export type OAuthProvider = "google" | "github";

export interface ClientConfig {
  baseUrl: string;
  databaseId: string;
  token?: string;
  refreshToken?: string;
  localStore?: LocalStore;
  enableRealtime?: boolean;
  enableSync?: boolean;
}

export interface HealthCheck {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  databases?: Array<{ id?: string; name: string; path: string; created_at: string }>;
  database_list?: string[];
}

export type TypedRecord<Fields> = Fields & BoltstoreRecord;

export interface TypedCollection<Fields> {
  create(data: Omit<Fields, "id" | "created_at" | "updated_at">): Promise<TypedRecord<Fields>>;
  update(id: string, data: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>): Promise<TypedRecord<Fields>>;
  delete(id: string): Promise<void>;
  batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult>;
  createQuery(): ClientQueryBuilder<TypedRecord<Fields>>;
  subscribe(callback: (event: RecordEvent) => void): () => void;
}

export interface TypedBatchOperation<Fields> {
  action: "create" | "update" | "delete";
  id?: string;
  data?: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>;
}
