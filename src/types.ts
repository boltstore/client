export interface ClientConfig {
  url: string;
  database: string;
  key?: string;
  keyProvider?: () => string | undefined | Promise<string | undefined>;
  timeout?: number;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt?: string;
  group?: string;
  readonly?: boolean;
  tables?: string[];
}

export interface HealthCheck {
  status: string;
  version: string;
  databases: number;
}

export interface ApiKey {
  id: string;
  label: string;
  created_at: string;
  last_used_at?: string;
}

export interface CreatedApiKey {
  id: string;
  label: string;
  key: string;
}

export interface TableSchema {
  name: string;
  columns: TableColumn[];
}

export interface TableColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value?: string;
  pk: number;
}

export interface ColumnDef {
  name: string;
  type: "text" | "integer" | "real" | "blob" | "numeric" | "boolean" | "date" | "datetime";
  nullable?: boolean;
  primary_key?: boolean;
  auto_increment?: boolean;
  unique?: boolean;
  references?: { table: string; column: string };
  default?: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit?: number;
  offset?: number;
}
