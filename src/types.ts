export interface ClientConfig {
  url: string;
  database: string;
  key?: string;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
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

export interface CreatedApiKey extends ApiKey {
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
  type: "text" | "integer" | "real" | "blob" | "numeric" | "boolean";
  nullable?: boolean;
  primary_key?: boolean;
  unique?: boolean;
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
  limit: number;
  offset: number;
}
