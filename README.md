# @boltstore/client

Browser-first JavaScript/TypeScript SDK for Boltstore.

**Note:** Realtime subscriptions and offline sync are opt-in features that must be explicitly enabled. See [Feature Flags](#client) below.

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
const list = await posts.list({ sort: "created_at", direction: "desc" });

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
const list = await client.collection("todos").list();
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
col.list(options?: ListOptions & QueryOptions): Promise<TypedRecord<Fields>[]>;
col.get(id: string): Promise<TypedRecord<Fields>>;
col.update(id: string, data: Partial<Fields>): Promise<TypedRecord<Fields>>;
col.delete(id: string): Promise<void>;
col.count(filter?): Promise<number>;
col.distinct(field): Promise<unknown[]>;
col.batch(operations): Promise<BatchResult>;
col.paginate(options): Promise<PaginatedResult<TypedRecord<Fields>>>;
col.subscribe(callback): () => void;  // requires enableRealtime, no-op otherwise
```

### Filtering, sorting, pagination

```typescript
// Simple filter (GET /records with URL params)
col.list({ filter: { status: "active" }, sort: "created_at", direction: "desc", limit: 10 });

// Complex filter DSL (POST /query)
col.list({
  filter: {
    status: { $in: ["active", "pending"] },
    priority: { $gte: 5 },
    $or: [{ assignee: userId }, { is_public: true }],
  },
  search: "keyword",
  searchFields: ["title", "body"],
  fields: ["id", "title"],
  expand: ["author"],
});

// Pagination
col.paginate({ page: 1, perPage: 20, sort: "created_at", direction: "desc" });
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
