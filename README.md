# @boltstore/client

JavaScript/TypeScript SDK for [Boltstore](https://github.com/boltstore/boltstore) — the self-hostable SQLite-over-HTTP **Database-as-a-Service**.

HTTP-only. No realtime, no offline sync, no client-side cache. Boltstore is a database platform (DBaaS), not a BaaS — BaaS-style features (RLS, user auth, realtime, sync) are application-layer concerns or future plugin territory, not part of this SDK. The client talks to the Boltstore server REST API directly.

## Installation

```bash
npm install @boltstore/client
```

## Quick start

```typescript
import { BoltstoreClient } from "@boltstore/client";

const client = new BoltstoreClient({
  url: "http://localhost:8080",
  database: "myapp",
  key: "boltstore_...", // per-database API key, or an admin session token for admin methods
});

// Tables
const tables = await client.tables.list();
await client.tables.create("posts", [
  { name: "id", type: "integer", primary_key: true, auto_increment: true },
  { name: "title", type: "text", nullable: false },
  { name: "views", type: "integer", default: "0" },
]);

// Typed record CRUD
const posts = client.table<{ id: number; title: string; views: number }>("posts");
const created = await posts.create({ title: "Hello World", views: 0 });
const fetched = await posts.get(created.id);
await posts.update(created.id, { views: 1 });
await posts.delete(created.id);

// Query builder
const list = await posts
  .query()
  .where("title", "like", "Hello%")
  .orderBy("id", "desc")
  .limit(10)
  .get();

// Raw SQL (SELECT only for non-admin keys — see server README)
const rows = await client.sql<{ id: number; title: string }>(
  "SELECT id, title FROM posts WHERE views > ? ORDER BY id",
  [0],
);
```

## Configuration

```typescript
const client = new BoltstoreClient({
  url: string;        // Boltstore server base URL, e.g. "http://localhost:8080"
  database: string;   // Database name (must match VALID_NAME: /^[a-z0-9][a-z0-9_-]*$/)
  key?: string;       // API key or admin session token. Set later via setKey().
});

client.setKey(key: string | undefined): void;
```

The `key` is sent as `Authorization: Bearer <key>` on every request. Use a per-database API key for data access, or an admin session token (from `POST /api/admin/login`) for admin methods.

## API

### Database operations

```typescript
// Requires admin key/session
await client.info(): Promise<DatabaseInfo>;       // GET /api/databases/:database
await client.delete(): Promise<void>;             // DELETE /api/databases/:database
await client.export(): Promise<Blob>;             // POST /api/databases/:database/export
await BoltstoreClient.import({                    // static — POST /api/databases/import
  url: string;
  file: Blob | File;
  name?: string;
  key?: string;
}): Promise<DatabaseInfo>;
```

### Config

```typescript
// Requires admin key/session
await client.config.get(): Promise<Record<string, unknown>>;
await client.config.update(data: Record<string, unknown>): Promise<Record<string, unknown>>;
```

### API keys

```typescript
// Requires admin key/session
await client.keys.list(): Promise<ApiKey[]>;
await client.keys.create(label: string): Promise<CreatedApiKey>; // key is returned once
await client.keys.rotate(keyId: string): Promise<{ id: string; key: string }>;
await client.keys.revoke(keyId: string): Promise<void>;
```

### Tables

```typescript
// Accessible with API key or admin
await client.tables.list(): Promise<string[]>;
await client.tables.create(name: string, columns: ColumnDef[]): Promise<{ name: string; columns: ColumnDef[] }>;
await client.tables.get(name: string): Promise<TableSchema>;
await client.tables.update(name: string, changes: {
  name?: string;
  add_columns?: ColumnDef[];
  drop_columns?: string[];
  rename_column?: { from: string; to: string };
}): Promise<void>;
await client.tables.delete(name: string): Promise<void>;
```

### Records (typed)

```typescript
const t = client.table<Fields>("table_name");

await t.create(data: Fields): Promise<Fields>;
await t.list(opts?: {
  filter?: Record<string, unknown>;   // compiled to server filter DSL
  sort?: string;                       // e.g. "created_at" or "-views,created_at"
  limit?: number;                      // server max is 1000, default 50
  offset?: number;
  fields?: string[];                   // column projection
}): Promise<PaginatedResult<Fields>>;
await t.get(id: string | number): Promise<Fields | null>;
await t.update(id: string | number, data: Partial<Fields>): Promise<Fields>;
await t.delete(id: string | number): Promise<void>;
t.query(): QueryBuilder<Fields>;
```

### Query builder

```typescript
const q = t.query();

q.where(field: string, op: string, value: unknown): this;   // op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "glob"
q.orWhere(field: string, op: string, value: unknown): this;
q.orderBy(field: string, dir?: "asc" | "desc"): this;
q.limit(n: number): this;
q.offset(n: number): this;
q.select(...fields: (keyof Fields)[]): this;

await q.get(): Promise<Fields[]>;          // returns matching rows
await q.first(): Promise<Fields | null>;   // limit(1).get()[0] ?? null
await q.count(): Promise<number>;          // ⚠️ see "Known issues" below
await q.paginate(page: number, perPage?: number): Promise<PaginatedResult<Fields>>;
```

### Raw SQL

```typescript
await client.sql<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
```

Sends `{ sql, params }` to `POST /api/databases/:database/query`. Per the server's policy, **non-admin API keys may only execute `SELECT` statements**; DDL/DML/`PRAGMA`/`ATTACH` require an admin key. See the server README's "Raw SQL endpoint" section.

### Health

```typescript
await client.health(): Promise<HealthCheck>; // { status, version, databases }
```

## Types

```typescript
interface DatabaseInfo { id: string; name: string; path: string; createdAt: string; tables?: string[]; }
interface ApiKey { id: string; label: string; created_at: string; last_used_at?: string; }
interface CreatedApiKey extends ApiKey { key: string; }
interface TableSchema { name: string; columns: TableColumn[]; }
interface TableColumn { cid: number; name: string; type: string; notnull: number; dflt_value?: string; pk: number; }
interface ColumnDef {
  name: string;
  type: "text" | "integer" | "real" | "blob" | "numeric" | "boolean" | "date" | "datetime";
  nullable?: boolean;
  primary_key?: boolean;
  auto_increment?: boolean;
  unique?: boolean;
  default?: string;
  references?: { table: string; column: string };
}
interface ApiResponse<T> { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown }; }
interface PaginatedResult<T> { data: T[]; total: number; limit: number; offset: number; }
interface HealthCheck { status: string; version: string; databases: number; }
```

## Authentication model

The SDK holds a single `key` used for every request. Methods that hit `/api/databases/*` admin routes (database `info`/`delete`/`export`, `config.*`, `keys.*`) require an **admin session token** or an admin API key. Methods that hit `/api/databases/:db/tables/*`, `/records/*`, and `/query` accept either a per-database API key or an admin credential.

If you only have a per-database API key, use the `tables`, `table()`, `records`, and `sql()` methods. Calling `info()`, `keys.list()`, or `config.get()` will return `401 UNAUTHORIZED`.

## Known issues

- **Server-enforced limits apply.** The server caps list results at 1000 records per request. Use `offset` with `list()` for pagination beyond this limit.

## Development

```bash
bun install
bun run build    # compile TypeScript to dist/
bun test         # run tests
bun run dev      # watch mode
```

## Publishing

```bash
npm publish
```

## License

MIT