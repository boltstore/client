import type {
  ApiResponse,
  BoltstoreRecord,
  ListOptions,
  BatchOperation,
  BatchResult,
  QueryOptions,
  PaginationMeta,
} from "@boltstore/utils";

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
  /**
   * Database name.
   * @deprecated Will be removed in the next major release. Use `databaseId` instead.
   */
  database?: string;
  /** Database ID (dbs_ prefix). Takes precedence over database name. */
  databaseId?: string;
  token?: string;
  refreshToken?: string;
}

export interface HealthCheck {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  databases?: Array<{ name: string; created_at: string }>;
  database_list?: string[];
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export type TypedRecord<Fields> = Fields & BoltstoreRecord;

export interface PaginateOptions {
  page: number;
  perPage?: number;
  sort?: string;
  direction?: "asc" | "desc";
  filter?: Record<string, unknown>;
}

export interface TypedCollection<Fields> {
  create(data: Omit<Fields, "id" | "created_at" | "updated_at">): Promise<TypedRecord<Fields>>;
  list(options?: ListOptions): Promise<TypedRecord<Fields>[]>;
  get(id: string): Promise<TypedRecord<Fields>>;
  update(id: string, data: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>): Promise<TypedRecord<Fields>>;
  delete(id: string): Promise<void>;
  count(filter?: Partial<Fields & Record<string, unknown>>): Promise<number>;
  distinct(field: keyof Fields & string): Promise<unknown[]>;
  batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult>;
  paginate(options: PaginateOptions): Promise<PaginatedResult<TypedRecord<Fields>>>;
  listAll(options?: Omit<PaginateOptions, "page">): Promise<TypedRecord<Fields>[]>;
}

export interface TypedBatchOperation<Fields> {
  action: "create" | "update" | "delete";
  id?: string;
  data?: Partial<Omit<Fields, "id" | "created_at" | "updated_at">>;
}