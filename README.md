# @boltstore/client

Browser-first JavaScript/TypeScript SDK for Boltstore with automatic offline sync and realtime subscriptions.

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

// Live subscriptions — auto-connected WebSocket
const unsubscribe = posts.subscribe((event) => {
  console.log(event.event, event.record); // "create" | "update" | "delete"
});

// Auth
const { accessToken, refreshToken } = await client.auth.login("user@example.com", "secret");
```

## API

### Client

```typescript
const client = new BoltstoreClient({
  baseUrl: string;
  databaseId: string;
  token?: string;           // optional, set after login
  refreshToken?: string;    // optional
  localStore?: LocalStore;  // optional, defaults to IndexedDbStore in browser
});

client.setToken(token: string | undefined): void;
client.getToken(): string | undefined;
client.setRefreshToken(token: string | undefined): void;
client.getRefreshToken(): string | undefined;
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
col.subscribe(callback): () => void;  // live changes, returns unsubscribe
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

### Live subscriptions

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

### Offline behavior

Offline support is built-in and automatic. When the browser is offline:

- **Writes** are stored locally in IndexedDB and queued for sync
- **Reads** return cached data from IndexedDB with the same query API
- **Filters, sorting, and search** work offline using the client-side filter engine
- **Reconnection** is automatic — queued writes are flushed and missed changes are replayed via WebSocket

The local cache is enabled by default (`IndexedDbStore` in browsers). No configuration needed.

```typescript
// Everything works the same online and offline:
await col.create({ title: "Offline?" });  // writes locally, syncs later
const items = await col.list();            // reads from cache if offline
```

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