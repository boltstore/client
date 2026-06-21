# @boltstore/client

Browser-first JavaScript/TypeScript SDK for Boltstore.

**Note:** Realtime subscriptions and offline sync are opt-in features that must be explicitly enabled.

## Installation

```bash
npm install @boltstore/client
```

## Quick start

```typescript
import { BoltstoreClient } from "@boltstore/client";

const client = new BoltstoreClient({
  baseUrl: "http://localhost:8080",
  databaseId: "dbs_xxx",
});

// Collections
const collections = await client.collections.list();

// Typed CRUD
const posts = client.collection("posts");

const record = await posts.create({ title: "Hello World" });
const updated = await posts.update(record.id, { title: "Updated" });
await posts.delete(record.id);

// Query builder (replaces list/get/count/paginate — one API)
const results = await posts
  .createQuery()
  .where("status", "published")
  .whereGte("views", 100)
  .orderBy("created_at", "desc")
  .limit(10)
  .get();

const first = await posts
  .createQuery()
  .where("slug", "hello-world")
  .first();

const total = await posts
  .createQuery()
  .where("author_id", userId)
  .count();

const page = await posts
  .createQuery()
  .where("category", "tech")
  .orderBy("created_at", "desc")
  .paginate(1, 20);

// Auth
const { accessToken, refreshToken } = await client.auth.login("user@example.com", "secret");
```

## API

### Client

```typescript
const client = new BoltstoreClient({
  baseUrl: string;
  databaseId: string;
  token?: string;            // optional, set after login
  refreshToken?: string;     // optional
  localStore?: LocalStore;   // optional, only used when enableSync is true
  enableRealtime?: boolean;  // default: false — ⚠️ unstable
  enableSync?: boolean;      // default: false — ⚠️ unstable
});

client.setToken(token: string | undefined): void;
client.getToken(): string | undefined;
client.setRefreshToken(token: string | undefined): void;
client.getRefreshToken(): string | undefined;
```

> **⚠️ Unstable:** Realtime and sync features are experimental. They work for basic use cases but may have edge cases with reconnection, conflict resolution, and token expiry during extended offline periods. Enable at your own risk.

**Feature flags:**

| Flag | Default | When disabled | When enabled |
|---|---|---|---|
| `enableRealtime` | `false` | No WebSocket, `subscribe()` returns no-op | WebSocket subscriptions for live updates |
| `enableSync` | `false` | Direct HTTP only, no local cache | IndexedDB offline cache with auto-sync |

**MVP usage (no realtime, no sync):**
```typescript
const client = new BoltstoreClient({ baseUrl, databaseId });
// All operations go directly to the server via HTTP.
// No WebSocket, no IndexedDB, no offline fallback.
const todo = await client.collection("todos").create({ title: "Hello" });
const list = await client.collection("todos").createQuery().get();
```

### Collections (schema, read-only)

```typescript
client.collections.list(): Promise<CollectionInfo[]>
client.collections.get(name: string): Promise<CollectionInfo>
```

### Records (typed CRUD via `client.collection()`)

```typescript
const col = client.collection<Fields>("collection_name");

col.create(data): Promise<TypedRecord<Fields>>;
col.update(id: string, data: Partial<Fields>): Promise<TypedRecord<Fields>>;
col.delete(id: string): Promise<void>;
col.batch(operations): Promise<BatchResult>;
col.subscribe(callback): () => void;  // requires enableRealtime, no-op otherwise
col.createQuery(): ClientQueryBuilder<Fields>;  // replaces list/get/count/paginate
```

### Query builder (replaces `list`, `get`, `count`, `distinct`, `paginate`)

All read operations use the same builder:

```typescript
// Filtering
col.createQuery()
  .where("status", "active")            // shorthand equality
  .where("views", "gt", 100)            // explicit operator
  .whereGte("priority", 5)              // typed method
  .whereIn("category", ["a", "b"])
  .whereNull("deleted_at")
  .where((q) => q.where("x", 1).orWhere("y", 2))  // nested groups
  .get();

// Sorting
col.createQuery()
  .orderBy("created_at", "desc")
  .orderBy("name")                      // defaults to asc
  .get();

// Projection
col.createQuery()
  .select("id", "title", "author.name") // JSON path support
  .get();

// Search
col.createQuery()
  .search("keyword", ["title", "body"])
  .get();

// Aggregation
col.createQuery()
  .where("category", "tech")
  .aggregate({ function: "$count", alias: "total" })
  .get();

// Group by with having
col.createQuery()
  .aggregate({ function: "$count", alias: "cnt" })
  .groupBy("category")
  .having("cnt", "gt", 1)
  .get();

// Convenience methods
col.createQuery().where("id", recordId).first();    // single record or null
col.createQuery().where("author", userId).count();  // count total
col.createQuery().paginate(1, 20);                  // { data, meta: { page, per_page, total, total_pages } }

// Cross-collection queries
client.createQuery()
  .from("posts")
  .join("authors", [{ left: "posts.author_id", operator: "=", right: "authors.id" }])
  .where("authors.role", "admin")
  .get();
```

### Live subscriptions (requires `enableRealtime: true`)

```typescript
// Subscribe to all changes on a collection
const unsub = col.subscribe((event) => {
  // event.event: "create" | "update" | "delete"
  // event.record: the changed record
  // event.previous: previous state (for updates)
});

// Unsubscribe
unsub();
```

### Health

```typescript
client.health.check(): Promise<HealthCheck>;
```

### Offline behavior (requires `enableSync: true`)

When both `enableSync: true` is set on the client and `enableSync: true` is set on the server, the SDK caches data in IndexedDB and syncs changes when the connection is restored.

```typescript
const client = new BoltstoreClient({
  baseUrl, databaseId,
  enableSync: true,     // ⚠️ unstable
  enableRealtime: true, // ⚠️ unstable — required for push notification of remote changes
});
```

Offline behavior:
- **Writes** are stored locally in IndexedDB and queued for sync
- **Reads** return cached data from IndexedDB with the same query API
- **Filters, sorting, and search** work offline using the client-side filter engine
- **Reconnection** is automatic — queued writes are flushed and remote changes are replayed via WebSocket

## Development

```bash
bun install
bun run build    # compile TypeScript
bun test         # run tests
bun run dev      # watch mode
```

## Publishing

```bash
npm publish
```

## License

MIT
