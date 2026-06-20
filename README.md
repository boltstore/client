# @boltstore/client

JavaScript/TypeScript SDK for Boltstore. Works in the browser, Node.js, and React Native.

## Installation

```bash
npm install @boltstore/client
```

## Quick start

```typescript
import { BoltStoreClient } from "@boltstore/client";

const client = new BoltStoreClient({
  url: "http://localhost:8080",
});

// Collections
const collections = await client.collections.list();

// Records
const records = await client.records.list("posts", {
  filter: "status:eq:published",
  sort: ["created_at:desc"],
  pagination: { page: 1, perPage: 20 },
});

const record = await client.records.create("posts", {
  title: "Hello World",
  content: "My first post",
});

const updated = await client.records.update("posts", record.id, {
  title: "Updated title",
});

await client.records.delete("posts", record.id);

// Auth (Phase 2)
const { token, user } = await client.auth.login({
  email: "user@example.com",
  password: "secret",
});

// Realtime (Phase 3)
const unsubscribe = client.realtime.subscribe("posts", (event) => {
  console.log("Change:", event);
});

// Sync (Phase 4)
client.sync.start({ collections: ["posts"] });
```

## API

### Client

```typescript
const client = new BoltStoreClient({ url: string, token?: string });
client.setToken(token: string);
client.onTokenExpired(callback: () => Promise<string>);
```

### Collections

```typescript
client.collections.list(): Promise<Collection[]>
client.collections.get(name: string): Promise<Collection>
```

### Records

```typescript
client.records.list(collection: string, options?: QueryOptions): Promise<PaginatedResponse>
client.records.get(collection: string, id: string): Promise<Record>
client.records.create(collection: string, data: object): Promise<Record>
client.records.update(collection: string, id: string, data: object): Promise<Record>
client.records.delete(collection: string, id: string): Promise<void>
client.records.count(collection: string, filter?: string): Promise<number>
```

### Query Options

```typescript
interface QueryOptions {
  filter?: string;
  sort?: string[];
  page?: number;
  perPage?: number;
  cursor?: string;
  limit?: number;
  fields?: string[];
  expand?: string[];
  search?: string;
}
```

### Realtime

```typescript
// Subscribe to collection changes
const unsubscribe = client.realtime.subscribe("posts", (event) => {
  console.log("Change:", event);
});

// Subscribe with recordId and filter
client.realtime.subscribe("posts", {
  recordId: "rec_123",
  filter: { status: "published" },
  onEvent: (event) => console.log("Event:", event),
  onError: (err) => console.error("Error:", err),
});

// Unsubscribe
unsubscribe();

// Lifecycle hooks
client.realtime.onConnected(() => console.log("Connected"));
client.realtime.onDisconnected(() => console.log("Disconnected"));

// Manual connection control
client.realtime.connect();
client.realtime.disconnect();
client.realtime.close();
```

### Sync (Phase 4)

```typescript
// Pull changes since last sync
const result = await client.sync.pull();
console.log(result.changes);    // SyncChange[]
console.log(result.cursor);     // cursor for next pull
console.log(result.hasMore);    // whether more changes exist

// Push local changes to server
const pushResult = await client.sync.push([
  { event: "create", collection: "posts", data: { title: "New" } },
  { event: "update", collection: "posts", id: "rec_xxx", data: { title: "Updated" } },
  { event: "delete", collection: "posts", id: "rec_yyy" },
]);
console.log(pushResult.ok, pushResult.results);

// Periodic background sync
await client.sync.start({ collections: ["posts", "comments"], intervalMs: 15000 });
client.sync.stop();

// Sync state persistence
await client.sync.saveState();   // persists current cursor to server
const state = await client.sync.getState();
console.log(state?.cursor, state?.lastSyncAt);

// Sync status
const status = client.sync.status();
console.log(status.running, status.lastCursor);
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