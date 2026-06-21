import type { ClientConfig, DatabaseInfo, HealthCheck, ApiKey, CreatedApiKey, TableSchema, ColumnDef, ApiResponse, PaginatedResult } from "./types";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class BoltstoreClient {
  private baseUrl: string;
  private database: string;
  private key: string | undefined;

  constructor(config: ClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.database = config.database;
    this.key = config.key;
  }

  setKey(key: string | undefined): void {
    this.key = key;
  }

  // --- Database operations ---

  async info(): Promise<DatabaseInfo> {
    return this.adminReq<DatabaseInfo>("GET", `/api/databases/${this.database}`);
  }

  async delete(): Promise<void> {
    await this.adminReq("DELETE", `/api/databases/${this.database}`);
  }

  async export(): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`;
    const res = await globalThis.fetch(`${this.baseUrl}/api/databases/${this.database}/export`, { method: "POST", headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Export failed (${res.status})`);
    }
    return res.blob();
  }

  static async import(config: { url: string; file: Blob | File; name?: string; key?: string }): Promise<DatabaseInfo> {
    const form = new FormData();
    form.append("file", config.file);
    if (config.name) form.append("name", config.name);
    const headers: Record<string, string> = {};
    if (config.key) headers["Authorization"] = `Bearer ${config.key}`;
    const res = await globalThis.fetch(`${config.url.replace(/\/$/, "")}/api/databases/import`, { method: "POST", headers, body: form });
    const json = await res.json() as ApiResponse<DatabaseInfo>;
    if (json.error) throw new Error(json.error.message);
    return json.data!;
  }

  // --- Config ---

  config = {
    get: async (): Promise<Record<string, unknown>> => {
      return this.adminReq<Record<string, unknown>>("GET", `/api/databases/${this.database}/config`);
    },
    update: async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
      return this.adminReq<Record<string, unknown>>("PATCH", `/api/databases/${this.database}/config`, data);
    },
  };

  // --- API keys ---

  keys = {
    list: async (): Promise<ApiKey[]> => {
      const res = await this.adminReq<ApiKey[]>("GET", `/api/databases/${this.database}/keys`);
      return res ?? [];
    },
    create: async (label: string): Promise<CreatedApiKey> => {
      return this.adminReq<CreatedApiKey>("POST", `/api/databases/${this.database}/keys`, { label });
    },
    revoke: async (keyId: string): Promise<void> => {
      await this.adminReq("DELETE", `/api/databases/${this.database}/keys/${keyId}`);
    },
    rotate: async (keyId: string): Promise<{ id: string; key: string }> => {
      return this.adminReq("POST", `/api/databases/${this.database}/keys/${keyId}/rotate`);
    },
  };

  // --- Tables ---

  tables = {
    list: async (): Promise<string[]> => {
      const res = await this.req<string[]>("GET", `/api/databases/${this.database}/tables`);
      return res ?? [];
    },
    create: async (name: string, columns: ColumnDef[]): Promise<{ name: string; columns: ColumnDef[] }> => {
      const res = await this.req<{ name: string; columns: ColumnDef[] }>("POST", `/api/databases/${this.database}/tables`, { name, columns });
      return res!;
    },
    get: async (name: string): Promise<TableSchema> => {
      const res = await this.req<TableSchema>("GET", `/api/databases/${this.database}/tables/${name}`);
      return res!;
    },
    update: async (name: string, changes: { add_columns?: ColumnDef[]; drop_columns?: string[] }): Promise<void> => {
      await this.req("PATCH", `/api/databases/${this.database}/tables/${name}`, changes);
    },
    delete: async (name: string): Promise<void> => {
      await this.req("DELETE", `/api/databases/${this.database}/tables/${name}`);
    },
  };

  // --- Typed table ---

  table<T extends Record<string, unknown> = Record<string, unknown>>(name: string): TableRef<T> {
    return new TableRef<T>(this, name);
  }

  // --- Raw SQL ---

  async sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const res = await this.req<T[]>("POST", `/api/databases/${this.database}/query`, { sql: query, params });
    return res ?? [];
  }

  // --- Health ---

  async health(): Promise<HealthCheck> {
    const res = await this.publicReq<HealthCheck>("GET", "/api/health");
    return res!;
  }

  // --- Internal: used by QueryBuilder ---

  async retrieveRecords(table: string, opts: { filter?: string; sort?: string; limit?: number; offset?: number; fields?: string[] }): Promise<{ data: any[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (opts.filter) searchParams.set("filter", opts.filter);
    if (opts.sort) searchParams.set("sort", opts.sort);
    if (opts.limit) searchParams.set("limit", String(opts.limit));
    if (opts.offset) searchParams.set("offset", String(opts.offset));
    if (opts.fields) opts.fields.forEach(f => searchParams.append("fields", f));
    const qs = searchParams.toString();
    const res = await this.req<any[]>("GET", `/api/databases/${this.database}/tables/${table}/records${qs ? "?" + qs : ""}`);
    return { data: res ?? [], total: (res as any)?.length ?? 0 };
  }

  // --- Internal request methods ---

  private async publicReq<T>(method: HttpMethod, path: string): Promise<T | undefined> {
    return this.request<T>(method, path);
  }

  private async adminReq<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const res = await this.request<T>(method, path, body, true);
    return res as T;
  }

  async req<T>(method: HttpMethod, path: string, body?: unknown): Promise<T | undefined> {
    return this.request<T>(method, path, body, false);
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown, requireAdmin?: boolean): Promise<T | undefined> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text().catch(() => "");

    if (!text) {
      if (response.ok) return undefined;
      throw new Error(`Request failed (${response.status})`);
    }

    const json = JSON.parse(text) as ApiResponse<T>;
    if (json.error) throw new Error(json.error.message);
    return json.data;
  }
}

// --- TableRef ---

export class TableRef<T extends Record<string, unknown>> {
  constructor(
    private client: BoltstoreClient,
    private name: string,
  ) {}

  async create(data: Omit<T, keyof Record<string, never>>): Promise<T> {
    const res = await this.client.req<T>("POST", `/api/databases/${this.client["database"]}/tables/${this.name}/records`, data);
    return res!;
  }

  async list(opts?: { filter?: Record<string, unknown>; sort?: string; limit?: number; offset?: number; fields?: string[] }): Promise<PaginatedResult<T>> {
    const searchParams = new URLSearchParams();
    if (opts?.filter) searchParams.set("filter", JSON.stringify(opts.filter));
    if (opts?.sort) searchParams.set("sort", opts.sort);
    if (opts?.limit) searchParams.set("limit", String(opts.limit));
    if (opts?.offset) searchParams.set("offset", String(opts.offset));
    if (opts?.fields) opts.fields.forEach(f => searchParams.append("fields", f));
    const qs = searchParams.toString();
    const res = await this.client.req<PaginatedResult<T>["data"]>("GET", `/api/databases/${this.client["database"]}/tables/${this.name}/records${qs ? "?" + qs : ""}`);
    return { data: res ?? [], total: 0, limit: opts?.limit ?? 50, offset: opts?.offset ?? 0 } as PaginatedResult<T>;
  }

  async get(id: string | number): Promise<T | null> {
    const res = await this.client.req<T>("GET", `/api/databases/${this.client["database"]}/tables/${this.name}/records/${id}`);
    return res ?? null;
  }

  async update(id: string | number, data: Partial<T>): Promise<T> {
    const res = await this.client.req<T>("PATCH", `/api/databases/${this.client["database"]}/tables/${this.name}/records/${id}`, data);
    return res!;
  }

  async delete(id: string | number): Promise<void> {
    await this.client.req("DELETE", `/api/databases/${this.client["database"]}/tables/${this.name}/records/${id}`);
  }

  query(): QueryBuilder<T> {
    return new QueryBuilder(this.client, this.name);
  }
}

// --- QueryBuilder ---

type WhereClause = { field: string; op: string; value: unknown; or?: boolean };

export class QueryBuilder<T extends Record<string, unknown>> {
  private wheres: WhereClause[] = [];
  private orderByFields: string[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  private selectFields?: string[];

  constructor(
    private client: BoltstoreClient,
    private table: string,
  ) {}

  where(field: string, op: string, value: unknown): this {
    this.wheres.push({ field, op, value, or: false });
    return this;
  }

  orWhere(field: string, op: string, value: unknown): this {
    this.wheres.push({ field, op, value, or: true });
    return this;
  }

  orderBy(field: string, dir?: "asc" | "desc"): this {
    this.orderByFields.push(dir === "desc" ? `-${field}` : field);
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  offset(n: number): this {
    this.offsetCount = n;
    return this;
  }

  select(...fields: (keyof T)[]): this {
    this.selectFields = fields as string[];
    return this;
  }

  async get(): Promise<T[]> {
    const { data, total } = await this.execute();
    return data;
  }

  async first(): Promise<T | null> {
    const data = await this.limit(1).get();
    return data[0] ?? null;
  }

  async count(): Promise<number> {
    const { total } = await this.execute();
    return total;
  }

  async paginate(page: number, perPage = 50): Promise<PaginatedResult<T>> {
    this.limit(perPage);
    this.offset((page - 1) * perPage);
    const { data, total } = await this.execute();
    return { data, total, limit: perPage, offset: (page - 1) * perPage };
  }

  private async execute(): Promise<{ data: T[]; total: number }> {
    const filter: Record<string, any> = {};
    const orGroups: Record<string, any>[] = [];

    for (const w of this.wheres) {
      if (w.or) {
        orGroups.push({ [w.field]: { [`$${w.op}`]: w.value } });
      } else {
        filter[w.field] = { [`$${w.op}`]: w.value };
      }
    }

    if (orGroups.length > 0) filter.$or = orGroups;

    return this.client.retrieveRecords(this.table, {
      filter: Object.keys(filter).length > 0 ? JSON.stringify(filter) : undefined,
      sort: this.orderByFields.length > 0 ? this.orderByFields.join(",") : undefined,
      limit: this.limitCount,
      offset: this.offsetCount,
      fields: this.selectFields,
    });
  }
}

