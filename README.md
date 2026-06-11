# @boltstore/client

TypeScript SDK for Boltstore. Works in Bun, Node 18+, browsers, and React Native.

**Zero external dependencies** (only `@boltstore/utils` for types).

## Installation

```bash
npm install @boltstore/client
```

## Quick Start

```ts
import { BoltstoreClient, login, listRecords } from "@boltstore/client";

const client = new BoltstoreClient({
  url: "http://localhost:8090",
});

// Authenticate
await login(client, {
  email: "alice@example.com",
  password: "secret123",
});

// Query records
const todos = await listRecords(client, "todos", {
  filter: "status = 'active'",
  sort: "-created",
  perPage: 50,
});

console.log(todos.items);
```

## Features

| Module | Description |
|--------|-------------|
| `client.ts` | Main client — auth state, request helpers, auto-refresh |
| `auth.ts` | Login, register, refresh, logout, OAuth2 |
| `records.ts` | CRUD operations, filtering, sorting, pagination |
| `collections.ts` | Read/write collection schemas |
| `realtime.ts` | WebSocket subscriptions, auto-reconnect |
| `sync.ts` | Offline-first sync engine with conflict resolution |
| `storage.ts` | File upload, download, presigned URLs |
| `adapters/` | Platform adapters: Node/Bun, Web, React Native |
| `typegen/` | CLI to generate TypeScript types from your schema |

## Platform Adapters

```ts
// Node / Bun (auto-detected)
import { createNodeAdapter } from "@boltstore/client/adapters/node";

// Browser
import { createWebAdapter } from "@boltstore/client/adapters/web";

// React Native
import { createReactNativeAdapter } from "@boltstore/client/adapters/react-native";

// Or auto-detect
import { autoDetectAdapter } from "@boltstore/client/adapters/web";
```

## Realtime Subscriptions

```ts
import { connectRealtime } from "@boltstore/client";

const rt = connectRealtime(client);

const unsub = rt.subscribe("table:app_123:todos", (event) => {
  console.log(`${event.type}:`, event.record);
});

// Later: unsub(); to stop receiving events
```

## Offline Sync

```ts
import { enableSync } from "@boltstore/client";

const sync = enableSync(client, {
  collections: ["todos", "notes"],
  onConflict: (local, server, strategy) => {
    // Custom conflict resolution
    return server; // server-wins default
  },
});

// Track local changes
sync.trackLocalChange({
  rowId: "rec_123",
  collection: "todos",
  operation: "update",
  field: "title",
  newValue: "Updated offline",
});
```

## Type Generation

Generate TypeScript types from your Boltstore schema:

```bash
boltstore typegen --url http://localhost:8090 --output types.ts
```

## License

MIT
