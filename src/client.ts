import type { ClientConfig, DatabaseInfo, HealthCheck, ApiKey, CreatedApiKey, TableSchema, ColumnDef, ApiResponse, PaginatedResult } from "./types";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class BoltstoreClient {
  private baseUrl: string;
  private database: string;
  private key: string | undefined;
  private keyProvider?: () => string | undefined | Promise<string | undefined>;
  private timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.database = config.database;
    this.key = config.key;
    this.keyProvider = config.keyProvider;
    this.timeout = config.timeout ?? 30000;
    if (this.key && this.baseUrl.startsWith("http://") && !this.baseUrl.includes("localhost") && !this.baseUrl.includes("127.0.0.1") && !this.baseUrl.includes("::1")) {
      console.warn("[boltstore] Warning: Sending API keys over plain HTTP — use HTTPS in production.");
    }
  }

  setKey(key: string | undefined): void {
    this.key = key;
  }

  get databaseName(): string {
    return this.database;
  }

  private async resolveKey(): Promise<string | undefined> {
    if (this.keyProvider) return this.keyProvider();
    return this.key;
  }

  // --- Database operations ---

  async info(): Promise<DatabaseInfo> {
    const res = await this.adminReq<DatabaseInfo>("GET", `/api/databases/${this.database}`);
    if (!res) throw new Error("Empty response");
    return res;
  }

  async delete(): Promise<void> {
    await this.adminReq("DELETE", `/api/databases/${this.database}`);
  }

  async export(): Promise<Blob> {
    return this.requestBlob("POST", `/api/databases/${this.database}/export`);
  }

  async import(fileOrConfig: Blob | File | { file: Blob | File; name?: string }, name?: string): Promise<DatabaseInfo> {
    const key = await this.resolveKey();
    if (fileOrConfig instanceof Blob) {
      return BoltstoreClient.import({ url: this.baseUrl, file: fileOrConfig, name, key });
    }
    return BoltstoreClient.import({ url: this.baseUrl, file: fileOrConfig.file, name: fileOrConfig.name, key });
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
      const res = await this.adminReq<Record<string, unknown>>("GET", `/api/databases/${this.database}/config`);
      if (!res) throw new Error("Empty response");
      return res;
    },
    update: async (data: Record<string, unknown>): Promise<Record<string, unknown> | undefined> => {
      return this.adminReq<Record<string, unknown>>("PATCH", `/api/databases/${this.database}/config`, data);
    },
  };

  // --- API keys ---

  keys = {
    list: async (): Promise<ApiKey[]> => {
      const res = await this.adminReq<ApiKey[]>("GET", `/api/databases/${this.database}/keys`);
      return res ?? [];
    },
    create: async (label: string): Promise<CreatedApiKey | undefined> => {
      return this.adminReq<CreatedApiKey>("POST", `/api/databases/${this.database}/keys`, { label });
    },
    revoke: async (keyId: string): Promise<void> => {
      await this.adminReq("DELETE", `/api/databases/${this.database}/keys/${keyId}`);
    },
    rotate: async (keyId: string): Promise<{ id: string; key: string } | undefined> => {
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
    update: async (name: string, changes: { add_columns?: ColumnDef[]; drop_columns?: string[]; name?: string; rename_column?: { from: string; to: string } }): Promise<void> => {
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

  /**
   * Fetch records with filtering, sorting, and pagination.
   *
   * The `filter` parameter must be a JSON string (use JSON.stringify on objects).
   * This is a public API — callers are responsible for encoding their own filters.
   * The internal QueryBuilder handles this automatically.
   */
  async retrieveRecords(table: string, opts: { filter?: string; sort?: string; limit?: number; offset?: number; fields?: string[] }): Promise<{ data: Record<string, unknown>[]; total: number; meta?: Record<string, unknown> }> {
    const searchParams = new URLSearchParams();
    if (opts.filter) searchParams.set("filter", opts.filter);
    if (opts.sort) searchParams.set("sort", opts.sort);
    if (opts.limit !== undefined) searchParams.set("limit", String(opts.limit));
    if (opts.offset !== undefined) searchParams.set("offset", String(opts.offset));
    if (opts.fields) opts.fields.forEach(f => searchParams.append("fields", f));
    const qs = searchParams.toString();
    const res = await this.requestWithMeta<Record<string, unknown>[]>("GET", `/api/databases/${this.database}/tables/${table}/records${qs ? "?" + qs : ""}`);
    let total = typeof res.meta?.total === "number" ? res.meta.total : 0;
    if (typeof res.meta?.total !== "number") {
      const countParams = new URLSearchParams();
      if (opts.filter) countParams.set("filter", opts.filter);
      countParams.set("limit", "0");
      const countRes = await this.requestWithMeta<unknown[]>("GET", `/api/databases/${this.database}/tables/${table}/records?${countParams.toString()}`);
      total = typeof countRes.meta?.total === "number" ? countRes.meta.total : 0;
    }
    return { data: res.data ?? [], total, meta: res.meta };
  }

  // --- Internal request methods ---

  private async publicReq<T>(method: HttpMethod, path: string): Promise<T | undefined> {
    return this.request<T>(method, path);
  }

  private async adminReq<T>(method: HttpMethod, path: string, body?: unknown): Promise<T | undefined> {
    return this.request<T>(method, path, body);
  }

  async req<T>(method: HttpMethod, path: string, body?: unknown): Promise<T | undefined> {
    return this.request<T>(method, path, body);
  }

  private async requestWithMeta<T>(method: HttpMethod, path: string, body?: unknown): Promise<{ data: T | undefined; meta?: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
    const key = await this.resolveKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeout) };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text().catch(() => "");

    if (!text) {
      if (response.ok) return { data: undefined };
      throw new Error(`Request failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error(`Expected JSON response but got "${contentType || "none"}" (${response.status}): ${text.slice(0, 200)}`);
    }

    let json: ApiResponse<T>;
    try { json = JSON.parse(text) as ApiResponse<T>; } catch {
      throw new Error(`Invalid JSON response (${response.status}): ${text.slice(0, 200)}`);
    }
    if (json.error) throw new Error(json.error.message);
    return { data: json.data, meta: json.meta };
  }

  private async requestBlob(method: HttpMethod, path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    const key = await this.resolveKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const res = await globalThis.fetch(`${this.baseUrl}${path}`, { method, headers, signal: AbortSignal.timeout(this.timeout) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({} as Record<string, unknown>));
      const errBody = err?.error;
      const msg = typeof errBody === "string" ? errBody : typeof errBody?.message === "string" ? errBody.message : undefined;
      throw new Error(msg || `Request failed (${res.status})`);
    }
    return res.blob();
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T | undefined> {
    const { data } = await this.requestWithMeta<T>(method, path, body);
    return data;
  }
}

// --- TableRef ---

export class TableRef<T extends Record<string, unknown>> {
  constructor(
    private client: BoltstoreClient,
    private name: string,
  ) {}

  async create(data: Omit<T, keyof Record<string, never>>): Promise<T> {
    const res = await this.client.req<T>("POST", `/api/databases/${this.client.databaseName}/tables/${this.name}/records`, data);
    return res!;
  }

  async createBatch(data: T[]): Promise<T[]> {
    const res = await this.client.req<T[]>("POST", `/api/databases/${this.client.databaseName}/tables/${this.name}/records`, data);
    return res!;
  }

  async list(opts?: { filter?: Record<string, unknown>; sort?: string; limit?: number; offset?: number; fields?: string[] }): Promise<PaginatedResult<T>> {
    const filter = opts?.filter ? JSON.stringify(opts.filter) : undefined;
    const result = await this.client.retrieveRecords(this.name, {
      filter,
      sort: opts?.sort,
      limit: opts?.limit,
      offset: opts?.offset,
      fields: opts?.fields,
    });
    return {
      data: result.data as T[],
      total: result.total,
      limit: typeof result.meta?.limit === "number" ? result.meta.limit : opts?.limit,
      offset: typeof result.meta?.offset === "number" ? result.meta.offset : opts?.offset,
    };
  }

  async get(id: string | number): Promise<T | null> {
    const res = await this.client.req<T>("GET", `/api/databases/${this.client.databaseName}/tables/${this.name}/records/${id}`);
    return res ?? null;
  }

  async update(id: string | number, data: Partial<T>): Promise<T> {
    const res = await this.client.req<T>("PATCH", `/api/databases/${this.client.databaseName}/tables/${this.name}/records/${id}`, data);
    return res!;
  }

  async delete(id: string | number): Promise<void> {
    await this.client.req("DELETE", `/api/databases/${this.client.databaseName}/tables/${this.name}/records/${id}`);
  }

  query(): QueryBuilder<T> {
    return new QueryBuilder(this.client, this.name);
  }
}

// --- QueryBuilder ---

type WhereClause = { field: string; op: string; value: unknown; or?: boolean };

const SUPPORTED_OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "like", "glob"]);

function validateOp(op: string): void {
  if (!SUPPORTED_OPS.has(op)) {
    throw new Error(`Unsupported query operator "${op}". Supported: ${Array.from(SUPPORTED_OPS).join(", ")}`);
  }
}

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
    validateOp(op);
    this.wheres.push({ field, op, value, or: false });
    return this;
  }

  orWhere(field: string, op: string, value: unknown): this {
    validateOp(op);
    this.wheres.push({ field, op, value, or: true });
    return this;
  }

  andWhere(field: string, op: string | Record<string, unknown>, value?: unknown): this {
    if (typeof op === "object" && op !== null) {
      for (const [key, val] of Object.entries(op)) {
        validateOp(key);
        this.wheres.push({ field, op: key, value: val, or: false });
      }
    } else {
      validateOp(op as string);
      this.wheres.push({ field, op: op as string, value, or: false });
    }
    return this;
  }

  orderBy(field: string, dir?: "asc" | "desc"): this {
    this.orderByFields.push(dir === "desc" ? `-${field}` : field);
    return this;
  }

  limit(n: number): this {
    if (typeof n === "number" && n <= 0) throw new Error("limit must be a positive number");
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
    const savedLimit = this.limitCount;
    this.limitCount = 1;
    const data = await this.get();
    this.limitCount = savedLimit;
    return data[0] ?? null;
  }

  async count(): Promise<number> {
    const { total } = await this.execute(true);
    return total;
  }

  async paginate(page: number, perPage = 50): Promise<PaginatedResult<T>> {
    this.limit(perPage);
    this.offset((page - 1) * perPage);
    const { data, total } = await this.execute();
    return { data, total, limit: perPage, offset: (page - 1) * perPage };
  }

  private async execute(countOnly = false): Promise<{ data: T[]; total: number }> {
    const filter: Record<string, any> = {};
    const orGroups: Record<string, any>[] = [];

    for (const w of this.wheres) {
      if (w.or) {
        orGroups.push({ [w.field]: { [`$${w.op}`]: w.value } });
      } else {
        const existing = filter[w.field] as Record<string, unknown> | undefined;
        filter[w.field] = { ...(existing || {}), [`$${w.op}`]: w.value };
      }
    }

    if (orGroups.length > 0) filter.$or = orGroups;

    const result = await this.client.retrieveRecords(this.table, {
      filter: Object.keys(filter).length > 0 ? JSON.stringify(filter) : undefined,
      sort: countOnly ? undefined : (this.orderByFields.length > 0 ? this.orderByFields.join(",") : undefined),
      limit: countOnly ? 0 : this.limitCount,
      offset: countOnly ? 0 : this.offsetCount,
      fields: countOnly ? undefined : this.selectFields,
    });
    return { data: result.data as T[], total: result.total };
  }
}

