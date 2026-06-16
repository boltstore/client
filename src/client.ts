/**
 * BoltstoreClient — JavaScript/TypeScript SDK for Boltstore.
 *
 * Provides type-safe access to Boltstore's REST API. No dependencies
 * beyond `fetch` (built-in) and `@boltstore/utils` for types.
 *
 * **Important:** This SDK only exposes non-admin endpoints. Admin-only
 * operations (schema changes, indexes, views, raw SQL, backup/restore,
 * user management) must be performed via the server's admin API directly.
 *
 * Works in browser, Node.js (v18+), React Native, and Deno.
 *
 * @module @boltstore/client
 */

import type {
  ApiResponse,
  CollectionInfo,
  BoltstoreRecord,
  ListOptions,
  BatchOperation,
  BatchResult,
  QueryOptions,
  PaginationMeta,
} from "@boltstore/utils";

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

/** Token pair returned by login/refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** User profile as returned by /auth/me. */
export interface UserProfile {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
}

/** OAuth provider names. */
export type OAuthProvider = "google" | "github";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Boltstore client. */
export interface ClientConfig {
  /** Base URL of the Boltstore server (e.g., "http://localhost:8080"). */
  baseUrl: string;
  /** Default database to target for all requests. Can be overridden per-request. */
  database?: string;
  /** Optional JWT token for authenticated requests (Phase 2). */
  token?: string;
}

/** HTTP method. */
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Paginated response from list operations. */
export interface PaginatedResult<T> {
  /** Records for the current page. */
  data: T[];
  /** Pagination metadata. */
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Type-safe record helpers (module-level)
// ---------------------------------------------------------------------------

/**
 * A record with user-defined fields merged into the system fields.
 *
 * @example
 * ```ts
 * type User = { name: string; age: number; email: string };
 * const alice: TypedRecord<User> = {
 *   id: "rec_xxx",
 *   name: "Alice",
 *   age: 30,
 *   email: "alice@example.com",
 *   created_at: "...",
 *   updated_at: "..."
 * };
 * ```
 */
export type TypedRecord<Fields> = Fields & BoltstoreRecord;

/** Options for paginated listing. */
export interface PaginateOptions {
  /** Page number (1-based). */
  page: number;
  /** Items per page. Defaults to server default. */
  perPage?: number;
  /** Sort field. */
  sort?: string;
  /** Sort direction. */
  direction?: "asc" | "desc";
  /** Value-based filter (key = value). */
  filter?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Error thrown when the Boltstore API returns an error response. */
export class BoltstoreError extends Error {
  /** HTTP status code. */
  status: number;
  /** Error code from the API (e.g., "NOT_FOUND", "VALIDATION"). */
  code: string;
  /** Optional error details. */
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BoltstoreError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

/**
 * Client for interacting with a Boltstore server.
 *
 * Provides methods for databases, collections, and records — all
 * non-admin operations only.
 *
 * @example
 * ```ts
 * const client = new BoltstoreClient({
 *   baseUrl: "http://localhost:8080",
 *   database: "myapp",
 * });
 *
 * // Untyped
 * const records = await client.records.list("users", { sort: "name" });
 *
 * // Type-safe with collection builder
 * type User = { name: string; age: number };
 * const users = client.collection<User>("users");
 * const u = await users.list({ sort: "name" });
 * // u.data[0].name — fully typed
 *
 * // Pagination
 * const page1 = await client.records.paginate("users", { page: 1, perPage: 20 });
 * // page1.meta.totalPages, page1.data[0].name
 * ```
 */
export class BoltstoreClient {
  private baseUrl: string;
  private database: string | undefined;
  private token: string | undefined;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.database = config.database;
    this.token = config.token;
  }

  // -----------------------------------------------------------------------
  // Type-safe collection builder
  // -----------------------------------------------------------------------

  /**
   * Create a type-safe collection accessor for a specific collection.
   *
   * Returns an object with all record CRUD methods cast to use the
   * provided `Fields` type. This gives you full TypeScript type safety
   * without casting at each call site.
   *
   * @example
   * ```ts
   * type Post = { title: string; body: string; published: boolean };
   * const posts = client.collection<Post>("posts");
   *
   * // Create — data is type-checked
   * await posts.create({ title: "Hello", body: "...", published: true });
   *
   * // List — result is fully typed
   * const all = await posts.list();
   * console.log(all[0].title); // string, no cast needed
   *
   * // Paginate — even pagination results are typed
   * const page1 = await posts.paginate({ page: 1, perPage: 10 });
   * page1.data[0].body; // string
   * ```
   */
  collection<Fields = Record<string, unknown>>(name: string): TypedCollection<Fields> {
    return new TypedCollectionImpl<Fields>(this, name, this.dbPath);
  }

  // -----------------------------------------------------------------------
  // Auth (public + authenticated non-admin endpoints)
  // -----------------------------------------------------------------------

  /**
   * Authentication operations.
   *
   * Register and login are public. Logout, me, and updateProfile require
   * a token to be set on the client (via `config.token` or by calling
   * `client.setToken()` after login).
   *
   * @example
   * ```ts
   * // Register a new user
   * await client.auth.register("user@example.com", "password123");
   *
   * // Login and auto-set the token on the client
   * await client.auth.login("user@example.com", "password123");
   * // client is now authenticated — token sent on all subsequent requests
   *
   * // Get current user
   * const me = await client.auth.me();
   *
   * // Logout (revokes all tokens)
   * await client.auth.logout();
   * ```
   */
  auth = {
    /**
     * Register a new user account.
     *
     * Public endpoint — no authentication required.
     */
    register: async (email: string, password: string): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("POST", this.dbPath("/auth/register"), { email, password });
      return res.data!;
    },

    /**
     * Login and return a JWT token pair.
     *
     * Public endpoint. The token is automatically set on the client so
     * subsequent requests are authenticated.
     */
    login: async (email: string, password: string): Promise<TokenPair> => {
      const res = await this.request<TokenPair>("POST", this.dbPath("/auth/login"), { email, password });
      this.token = res.data!.accessToken;
      return res.data!;
    },

    /**
     * Refresh the access token using a refresh token.
     *
     * Public endpoint. The new access token is automatically set on the client.
     */
    refresh: async (refreshToken: string): Promise<TokenPair> => {
      const res = await this.request<TokenPair>("POST", this.dbPath("/auth/refresh"), { refreshToken });
      this.token = res.data!.accessToken;
      return res.data!;
    },

    /**
     * Logout and revoke all tokens for the current user.
     *
     * Requires authentication (Bearer token).
     */
    logout: async (): Promise<void> => {
      await this.request("POST", this.dbPath("/auth/logout"));
      this.token = undefined;
    },

    /**
     * Get the current user's profile.
     *
     * Requires authentication (Bearer token).
     */
    me: async (): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("GET", this.dbPath("/auth/me"));
      return res.data!;
    },

    /**
     * Update the current user's email and/or password.
     *
     * Requires authentication (Bearer token).
     */
    updateProfile: async (data: { email?: string; password?: string }): Promise<UserProfile> => {
      const res = await this.request<UserProfile>("PATCH", this.dbPath("/auth/me"), data);
      return res.data!;
    },

    /**
     * Get the OAuth authorization URL for a provider.
     *
     * Public endpoint. Redirect the user to the returned URL to start
     * the OAuth2 flow, then call `client.auth.oauthExchange()` with the
     * authorization code.
     */
    oauthUrl: async (provider: OAuthProvider, redirectUri: string): Promise<string> => {
      const res = await this.request<{ url: string }>(
        "GET",
        this.dbPath(`/auth/oauth/${provider}/url?redirect_uri=${encodeURIComponent(redirectUri)}`)
      );
      return res.data!.url;
    },

    /**
     * Exchange an OAuth authorization code for JWT tokens.
     *
     * Public endpoint. The access token is automatically set on the client.
     */
    oauthExchange: async (provider: OAuthProvider, code: string, redirectUri: string): Promise<TokenPair> => {
      const res = await this.request<TokenPair>("POST", this.dbPath(`/auth/oauth/${provider}`), {
        code,
        redirect_uri: redirectUri,
      });
      this.token = res.data!.accessToken;
      return res.data!;
    },
  };

  /** Manually set the token (e.g., after restoring from localStorage). */
  setToken(token: string | undefined): void {
    this.token = token;
  }

  /** Get the current token (e.g., to persist in localStorage). */
  getToken(): string | undefined {
    return this.token;
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  /** Check server health. */
  health = {
    check: async (): Promise<{ status: string; version: string; uptime: number; timestamp: string }> => {
      const res = await this.request("GET", "/api/health");
      return res.data as { status: string; version: string; uptime: number; timestamp: string };
    },
  };

  // -----------------------------------------------------------------------
  // Collections
  // -----------------------------------------------------------------------

  /**
   * Operations on collections (read-only, non-admin).
   */
  collections = {
    /** List all collections in the database. */
    list: async (): Promise<CollectionInfo[]> => {
      const res = await this.request<CollectionInfo[]>("GET", this.dbPath("/collections"));
      return res.data ?? [];
    },

    /** Get a single collection's schema and metadata. */
    get: async (name: string): Promise<CollectionInfo> => {
      const res = await this.request<CollectionInfo>("GET", this.dbPath(`/collections/${name}`));
      return res.data!;
    },
  };

  // -----------------------------------------------------------------------
  // Records
  // -----------------------------------------------------------------------

  /**
   * CRUD operations on records.
   */
  records = {
    /** Create a new record. */
    create: async (collection: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("POST", this.dbPath(`/collections/${collection}/records`), data);
      return res.data!;
    },

    /** List records with optional filtering, sorting, and pagination. */
    list: async (collection: string, options?: ListOptions): Promise<BoltstoreRecord[]> => {
      const path = this.buildListPath(collection, options);
      const res = await this.request<BoltstoreRecord[]>("GET", path);
      return res.data ?? [];
    },

    /** Get a single record by ID. */
    get: async (collection: string, id: string): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("GET", this.dbPath(`/collections/${collection}/records/${id}`));
      return res.data!;
    },

    /** Update an existing record. */
    update: async (collection: string, id: string, data: Record<string, unknown>): Promise<BoltstoreRecord> => {
      const res = await this.request<BoltstoreRecord>("PATCH", this.dbPath(`/collections/${collection}/records/${id}`), data);
      return res.data!;
    },

    /** Delete a record by ID. */
    delete: async (collection: string, id: string): Promise<void> => {
      await this.request("DELETE", this.dbPath(`/collections/${collection}/records/${id}`));
    },

    /** Count records matching an optional filter. */
    count: async (collection: string, filter?: Record<string, unknown>): Promise<number> => {
      const params = new URLSearchParams();
      if (filter) { for (const [k, v] of Object.entries(filter)) params.set(k, String(v)); }
      const qs = params.toString();
      const path = this.dbPath(`/collections/${collection}/records/count`) + (qs ? `?${qs}` : "");
      const res = await this.request<{ count: number }>("GET", path);
      return res.data?.count ?? 0;
    },

    /** Get distinct values for a field. */
    distinct: async (collection: string, field: string): Promise<unknown[]> => {
      const res = await this.request<{ field: string; values: unknown[] }>(
        "GET",
        this.dbPath(`/collections/${collection}/records/distinct?field=${encodeURIComponent(field)}`)
      );
      return res.data?.values ?? [];
    },

    /** Execute multiple create, update, delete in one request. */
    batch: async (collection: string, operations: BatchOperation[]): Promise<BatchResult> => {
      const res = await this.request<BatchResult>("POST", this.dbPath(`/collections/${collection}/records/batch`), operations);
      return res.data!;
    },

    // -------------------------------------------------------------------
    // Pagination helpers
    // -------------------------------------------------------------------

    /**
     * Offset-based paginated list.
     *
     * Uses `page` / `perPage` query params. The server returns pagination
     * metadata (`total`, `totalPages`, `page`, `perPage`) in the `meta`
     * envelope, which this method extracts.
     *
     * @example
     * ```ts
     * const page1 = await client.records.paginate("users", { page: 1, perPage: 25 });
     * console.log(page1.meta.totalPages); // number
     * for (const user of page1.data) { ... }
     * ```
     */
    paginate: async (collection: string, options: PaginateOptions): Promise<PaginatedResult<BoltstoreRecord>> => {
      const params = new URLSearchParams();
      params.set("page", String(options.page));
      if (options.perPage) params.set("per_page", String(options.perPage));
      if (options.sort) params.set("sort", options.sort);
      if (options.direction) params.set("direction", options.direction);
      if (options.filter) {
        for (const [k, v] of Object.entries(options.filter)) params.set(k, String(v));
      }
      const qs = params.toString();
      const path = this.dbPath(`/collections/${collection}/records`) + (qs ? `?${qs}` : "");
      const res = await this.request<BoltstoreRecord[]>("GET", path);
      const meta = res.meta ?? {};
      return {
        data: res.data ?? [],
        meta: {
          page: meta.page as number ?? options.page,
          perPage: meta.perPage as number ?? options.perPage ?? (res.data?.length ?? 0),
          total: meta.total as number ?? (res.data?.length ?? 0),
          totalPages: meta.totalPages as number ?? 1,
        },
      };
    },

    /**
     * List all records across all pages (auto-pagination).
     *
     * This makes multiple requests sequentially to fetch every record.
     * Use with caution on large datasets — prefer `paginate()` for
     * user-facing pagination.
     */
    listAll: async (collection: string, options?: Omit<PaginateOptions, "page">): Promise<BoltstoreRecord[]> => {
      const perPage = options?.perPage ?? 100;
      const all: BoltstoreRecord[] = [];
      let page = 1;

      while (true) {
        const result = await this.records.paginate(collection, { ...options, page, perPage });
        all.push(...result.data);
        if (page >= result.meta.totalPages) break;
        page++;
      }

      return all;
    },
  };

  // -----------------------------------------------------------------------
  // Query DSL
  // -----------------------------------------------------------------------

  /**
   * Execute an advanced query using the Boltstore query DSL.
   */
  async query(options: QueryOptions): Promise<{ data: BoltstoreRecord[]; meta: Record<string, unknown> }> {
    const res = await this.request<BoltstoreRecord[]>("POST", this.dbPath("/query"), options);
    return { data: res.data ?? [], meta: res.meta ?? {} };
  }

  // -----------------------------------------------------------------------
  // Internal: low-level request (used by TypedCollectionImpl)
  // -----------------------------------------------------------------------

  /** @internal */
  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
    let json: ApiResponse<T>;
    try { json = (await response.json()) as ApiResponse<T>; } catch {
      throw new BoltstoreError(response.status, "PARSE_ERROR", `Failed to parse response from Boltstore server (status ${response.status}).`);
    }
    if (json.error) {
      throw new BoltstoreError(response.status, json.error.code, json.error.message, json.error.details);
    }
    return json;
  }

  /** @internal Build a database-scoped path. */
  dbPath(path: string): string {
    if (this.database) return `/api/${this.database}${path}`;
    return `/api${path}`;
  }

  /** @internal Build URL with query params for list operations. */
  buildListPath(collection: string, options?: ListOptions): string {
    const params = new URLSearchParams();
    if (options?.sort) params.set("sort", options.sort);
    if (options?.direction) params.set("direction", options.direction);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    if (options?.fields) params.set("fields", options.fields.join(","));
    if (options?.expand) params.set("expand", options.expand.join(","));
    if (options?.filter) {
      for (const [k, v] of Object.entries(options.filter)) params.set(k, String(v));
    }
    const qs = params.toString();
    return this.dbPath(`/collections/${collection}/records`) + (qs ? `?${qs}` : "");
  }
}

// ---------------------------------------------------------------------------
// TypedCollection — type-safe builder
// ---------------------------------------------------------------------------

/**
 * Interface for a type-safe collection accessor.
 *
 * Returned by `client.collection<Fields>(name)`. All methods accept
 * and return `TypedRecord<Fields>` for full type inference.
 */
export interface TypedCollection<Fields> {
  /** Create a record in this collection. */
  create(data: Fields & Partial<BoltstoreRecord>): Promise<TypedRecord<Fields>>;
  /** List records. */
  list(options?: ListOptions): Promise<TypedRecord<Fields>[]>;
  /** Get a single record by ID. */
  get(id: string): Promise<TypedRecord<Fields>>;
  /** Update a record by ID. */
  update(id: string, data: Partial<Fields>): Promise<TypedRecord<Fields>>;
  /** Delete a record by ID. */
  delete(id: string): Promise<void>;
  /** Count records matching a filter. */
  count(filter?: Partial<Fields & Record<string, unknown>>): Promise<number>;
  /** Get distinct values for a field. */
  distinct(field: keyof Fields & string): Promise<unknown[]>;
  /** Execute multiple operations atomically. */
  batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult>;
  /** Offset-based paginated list. */
  paginate(options: PaginateOptions): Promise<PaginatedResult<TypedRecord<Fields>>>;
  /** Fetch all records across all pages. */
  listAll(options?: Omit<PaginateOptions, "page">): Promise<TypedRecord<Fields>[]>;
}

/** A batch operation typed for a specific collection. */
export interface TypedBatchOperation<Fields> {
  action: "create" | "update" | "delete";
  id?: string;
  data?: Partial<Fields>;
}

/** @internal Implementation of TypedCollection. */
class TypedCollectionImpl<Fields> implements TypedCollection<Fields> {
  constructor(
    private client: BoltstoreClient,
    private name: string,
    private dbPath: (path: string) => string,
  ) {}

  async create(data: Fields & Partial<BoltstoreRecord>): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "POST",
      this.dbPath(`/collections/${this.name}/records`),
      data as Record<string, unknown>,
    );
    return res.data!;
  }

  async list(options?: ListOptions): Promise<TypedRecord<Fields>[]> {
    const path = this.client.buildListPath(this.name, options);
    const res = await this.client.request<TypedRecord<Fields>[]>("GET", path);
    return res.data ?? [];
  }

  async get(id: string): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "GET",
      this.dbPath(`/collections/${this.name}/records/${id}`),
    );
    return res.data!;
  }

  async update(id: string, data: Partial<Fields>): Promise<TypedRecord<Fields>> {
    const res = await this.client.request<TypedRecord<Fields>>(
      "PATCH",
      this.dbPath(`/collections/${this.name}/records/${id}`),
      data as Record<string, unknown>,
    );
    return res.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.request("DELETE", this.dbPath(`/collections/${this.name}/records/${id}`));
  }

  async count(filter?: Partial<Fields & Record<string, unknown>>): Promise<number> {
    const params = new URLSearchParams();
    if (filter) { for (const [k, v] of Object.entries(filter)) params.set(k, String(v)); }
    const qs = params.toString();
    const path = this.dbPath(`/collections/${this.name}/records/count`) + (qs ? `?${qs}` : "");
    const res = await this.client.request<{ count: number }>("GET", path);
    return res.data?.count ?? 0;
  }

  async distinct(field: keyof Fields & string): Promise<unknown[]> {
    const res = await this.client.request<{ field: string; values: unknown[] }>(
      "GET",
      this.dbPath(`/collections/${this.name}/records/distinct?field=${encodeURIComponent(field)}`),
    );
    return res.data?.values ?? [];
  }

  async batch(operations: TypedBatchOperation<Fields>[]): Promise<BatchResult> {
    const res = await this.client.request<BatchResult>(
      "POST",
      this.dbPath(`/collections/${this.name}/records/batch`),
      operations,
    );
    return res.data!;
  }

  async paginate(options: PaginateOptions): Promise<PaginatedResult<TypedRecord<Fields>>> {
    const params = new URLSearchParams();
    params.set("page", String(options.page));
    if (options.perPage) params.set("per_page", String(options.perPage));
    if (options.sort) params.set("sort", options.sort);
    if (options.direction) params.set("direction", options.direction);
    if (options.filter) {
      for (const [k, v] of Object.entries(options.filter)) params.set(k, String(v));
    }
    const qs = params.toString();
    const path = this.dbPath(`/collections/${this.name}/records`) + (qs ? `?${qs}` : "");
    const res = await this.client.request<TypedRecord<Fields>[]>("GET", path);
    const meta = res.meta ?? {};
    return {
      data: res.data ?? [],
      meta: {
        page: meta.page as number ?? options.page,
        perPage: meta.perPage as number ?? options.perPage ?? (res.data?.length ?? 0),
        total: meta.total as number ?? (res.data?.length ?? 0),
        totalPages: meta.totalPages as number ?? 1,
      },
    };
  }

  async listAll(options?: Omit<PaginateOptions, "page">): Promise<TypedRecord<Fields>[]> {
    const perPage = options?.perPage ?? 100;
    const all: TypedRecord<Fields>[] = [];
    let page = 1;

    while (true) {
      const result = await this.paginate({ ...options, page, perPage });
      all.push(...result.data);
      if (page >= result.meta.totalPages) break;
      page++;
    }

    return all;
  }
}

export default BoltstoreClient;