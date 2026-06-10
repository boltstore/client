// ── Offline Sync Module ──
// Client-side sync engine for offline-first support.
// Manages local changes, pushes/pulls with server, handles conflicts.

import type { BoltstoreClient } from "./client";
import type {
  LamportClock,
  VersionVector,
  ChangeLogEntry,
  ClientSyncState,
  SyncConnectionState,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
  FieldChange,
} from "@boltstore/shared";
import type { SyncStrategy } from "@boltstore/shared";
import type { LocalDatabase } from "./adapters/node";

export interface SyncOptions {
  /** Collections to sync */
  collections: string[];
  /** Called when sync state changes */
  onStateChange?: (state: SyncConnectionState) => void;
  /** Called when a conflict is detected */
  onConflict?: (local: Record<string, unknown>, server: Record<string, unknown>, strategy: SyncStrategy) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Auto-start sync on connection */
  autoStart?: boolean;
  /** Optional local database for persistence (defaults to in-memory) */
  localDb?: LocalDatabase;
}

/**
 * Client-side sync engine.
 *
 * Manages the offline-first sync lifecycle:
 * 1. Track local changes with Lamport clocks
 * 2. Push pending changes to server on reconnect
 * 3. Pull server changes and merge into local state
 * 4. Handle conflicts via collection strategies
 */
export class SyncEngine {
  private client: BoltstoreClient;
  private options: SyncOptions;
  private state: ClientSyncState;
  private ws: WebSocket | null = null;
  private connectionState: SyncConnectionState = "disconnected";
  private localDb: LocalDatabase | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: BoltstoreClient, options: SyncOptions) {
    this.client = client;
    this.options = options;

    this.state = {
      clock: { counter: 0, nodeId: `client-${crypto.randomUUID().slice(0, 8)}` },
      versionVector: {},
      pendingChanges: [],
      syncing: false,
      consecutiveFailures: 0,
    };

    if (options.localDb) {
      this.localDb = options.localDb;
      this.initLocalDb();
    }
  }

  // ── State ──

  get connection(): SyncConnectionState {
    return this.connectionState;
  }

  get pendingChangeCount(): number {
    return this.state.pendingChanges.length;
  }

  get nodeId(): string {
    return this.state.clock.nodeId;
  }

  private setConnectionState(state: SyncConnectionState): void {
    this.connectionState = state;
    this.options.onStateChange?.(state);
  }

  // ── Local Database ──

  private initLocalDb(): void {
    if (!this.localDb) return;
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS _local_records (
        collection TEXT NOT NULL,
        row_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (collection, row_id)
      )
    `);
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS _local_changes (
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        field TEXT,
        value TEXT,
        clock INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS _local_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Load pending changes from local DB
    const rows = this.localDb.query<{ id: string; collection: string; row_id: string; operation: string; field: string | null; value: string | null; clock: number; client_id: string; timestamp: string }>(
      `SELECT * FROM _local_changes ORDER BY clock ASC`
    );
    for (const row of rows) {
      this.state.pendingChanges.push({
        id: row.id,
        collection: row.collection,
        rowId: row.row_id,
        operation: row.operation as "insert" | "update" | "delete",
        field: row.field ?? undefined,
        newValue: row.value ? JSON.parse(row.value) : undefined,
        clock: row.clock,
        clientId: row.client_id,
        timestamp: row.timestamp,
      });
    }

    // Load version vector
    const vvRow = this.localDb.queryOne<{ value: string }>(`SELECT value FROM _local_meta WHERE key = 'version_vector'`);
    if (vvRow) {
      try {
        this.state.versionVector = JSON.parse(vvRow.value);
      } catch {
        this.state.versionVector = {};
      }
    }
  }

  private savePendingChange(entry: ChangeLogEntry): void {
    if (!this.localDb) return;
    this.localDb.run(
      `INSERT INTO _local_changes (id, collection, row_id, operation, field, value, clock, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.collection, entry.rowId, entry.operation, entry.field ?? null, entry.newValue ? JSON.stringify(entry.newValue) : null, entry.clock, entry.clientId]
    );
  }

  private removePendingChange(id: string): void {
    if (!this.localDb) return;
    this.localDb.run(`DELETE FROM _local_changes WHERE id = ?`, [id]);
  }

  private saveVersionVector(): void {
    if (!this.localDb) return;
    this.localDb.run(
      `INSERT OR REPLACE INTO _local_meta (key, value) VALUES (?, ?)`,
      ["version_vector", JSON.stringify(this.state.versionVector)]
    );
  }

  /**
   * Cache a server record locally.
   */
  cacheRecord(collection: string, rowId: string, data: Record<string, unknown>): void {
    if (!this.localDb) return;
    this.localDb.run(
      `INSERT OR REPLACE INTO _local_records (collection, row_id, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [collection, rowId, JSON.stringify(data)]
    );
  }

  /**
   * Get a cached local record.
   */
  getCachedRecord(collection: string, rowId: string): Record<string, unknown> | null {
    if (!this.localDb) return null;
    const row = this.localDb.queryOne<{ data: string }>(
      `SELECT data FROM _local_records WHERE collection = ? AND row_id = ?`,
      [collection, rowId]
    );
    return row ? JSON.parse(row.data) : null;
  }

  /**
   * List all cached records for a collection.
   */
  listCachedRecords(collection: string): Record<string, unknown>[] {
    if (!this.localDb) return [];
    const rows = this.localDb.query<{ data: string }>(
      `SELECT data FROM _local_records WHERE collection = ?`,
      [collection]
    );
    return rows.map((r) => JSON.parse(r.data));
  }

  // ── Local Change Tracking ──

  /**
   * Record a local change for later push.
   */
  trackLocalChange(
    collection: string,
    rowId: string,
    operation: "insert" | "update" | "delete",
    fields: Record<string, unknown>
  ): void {
    this.state.clock.counter++;

    const entry: ChangeLogEntry = {
      id: `local_${crypto.randomUUID()}`,
      collection,
      rowId,
      operation,
      clock: this.state.clock.counter,
      clientId: this.state.clock.nodeId,
      timestamp: new Date().toISOString(),
    };

    // For update operations, track per-field changes
    if (operation === "update") {
      for (const [field, value] of Object.entries(fields)) {
        const fieldEntry: ChangeLogEntry = {
          ...entry,
          id: `local_${crypto.randomUUID()}`,
          field,
          newValue: value,
        };
        this.state.pendingChanges.push(fieldEntry);
        this.savePendingChange(fieldEntry);
      }
    } else {
      entry.newValue = fields;
      this.state.pendingChanges.push(entry);
      this.savePendingChange(entry);
    }
  }

  /**
   * Create a local record (tracks as pending insert).
   */
  createLocalRecord(collection: string, rowId: string, data: Record<string, unknown>): void {
    this.trackLocalChange(collection, rowId, "insert", data);
    this.cacheRecord(collection, rowId, data);
  }

  /**
   * Update a local record (tracks as pending update).
   */
  updateLocalRecord(collection: string, rowId: string, data: Record<string, unknown>): void {
    this.trackLocalChange(collection, rowId, "update", data);
    const existing = this.getCachedRecord(collection, rowId) ?? {};
    this.cacheRecord(collection, rowId, { ...existing, ...data });
  }

  /**
   * Delete a local record (tracks as pending delete).
   */
  deleteLocalRecord(collection: string, rowId: string): void {
    this.trackLocalChange(collection, rowId, "delete", {});
    if (this.localDb) {
      this.localDb.run(`DELETE FROM _local_records WHERE collection = ? AND row_id = ?`, [collection, rowId]);
    }
  }

  // ── Sync Operations ──

  /**
   * Start the sync connection.
   */
  async start(): Promise<void> {
    if (this.ws) return;
    this.setConnectionState("connecting");

    const baseUrl = (this.client as any).config?.url ?? "";
    const token = (this.client as any).authState?.token ?? "";
    const wsUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/ws" + (token ? `?token=${encodeURIComponent(token)}` : "");

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.setConnectionState("error");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = async () => {
      this.setConnectionState("connected");
      this.state.consecutiveFailures = 0;

      // Send sync start
      this.ws!.send(JSON.stringify({
        type: "sync_start",
        lastSeen: this.state.versionVector,
        clock: this.state.clock.counter,
      }));

      // Push pending changes
      if (this.state.pendingChanges.length > 0) {
        await this.pushChanges();
      }
    };

    this.ws.onmessage = async (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data.toString());

        switch (msg.type) {
          case "sync_pull": {
            const pull = msg as SyncPullResponse;
            await this.applyServerChanges(pull);
            break;
          }
          case "sync_ack": {
            const ack = msg as SyncPushResponse;
            this.handlePushResponse(ack);
            break;
          }
          case "sync_error": {
            console.warn("Sync error:", msg.code, msg.message);
            this.state.consecutiveFailures++;
            this.setConnectionState("error");
            break;
          }
        }
      } catch (err) {
        console.error("Failed to handle sync message:", err);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setConnectionState("disconnected");
      if (this.state.consecutiveFailures < 5) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.state.consecutiveFailures++;
      this.setConnectionState("error");
    };
  }

  /**
   * Stop the sync connection.
   */
  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setConnectionState("disconnected");
  }

  // ── Internal ──

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.state.consecutiveFailures), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  private async pushChanges(): Promise<void> {
    if (!this.ws || this.state.pendingChanges.length === 0) return;

    this.setConnectionState("syncing");
    this.state.syncing = true;

    // Group pending changes by rowId and collection
    const grouped = new Map<string, ChangeLogEntry[]>();
    for (const change of this.state.pendingChanges) {
      const key = `${change.collection}:${change.rowId}`;
      const existing = grouped.get(key) ?? [];
      existing.push(change);
      grouped.set(key, existing);
    }

    const changes: SyncPushRequest["changes"] = [];
    for (const entries of grouped.values()) {
      const first = entries[0];
      const fields: Record<string, FieldChange> = {};

      // For updates, group by field
      if (first.operation === "update") {
        for (const entry of entries) {
          if (entry.field) {
            fields[entry.field] = {
              field: entry.field,
              value: entry.newValue,
              clock: entry.clock,
              clientId: entry.clientId,
            };
          }
        }
      } else {
        // Insert or delete
        fields["__row__"] = {
          field: "__row__",
          value: first.newValue,
          clock: first.clock,
          clientId: first.clientId,
        };
      }

      changes.push({
        rowId: first.rowId,
        collection: first.collection,
        operation: first.operation,
        fields,
      });
    }

    const pushRequest: SyncPushRequest = {
      type: "sync_push",
      changes,
    };

    this.ws.send(JSON.stringify(pushRequest));
  }

  private handlePushResponse(response: SyncPushResponse): void {
    // Remove accepted changes from pending queue
    const acceptedSet = new Set(response.accepted);
    const remaining = this.state.pendingChanges.filter((c: ChangeLogEntry) => !acceptedSet.has(c.rowId));

    // Clean up accepted from local DB
    for (const acceptedId of response.accepted) {
      for (const change of this.state.pendingChanges) {
        if (change.rowId === acceptedId) {
          this.removePendingChange(change.id);
        }
      }
    }

    this.state.pendingChanges = remaining;

    // Update version vector with server's response
    this.state.versionVector[this.state.clock.nodeId] = this.state.clock.counter;
    this.saveVersionVector();

    // Report rejected changes
    for (const rejected of response.rejected) {
      console.warn(`Sync rejected: ${rejected.rowId} — ${rejected.reason}`);
    }

    this.state.syncing = false;
    this.state.consecutiveFailures = 0;
    this.state.lastSyncAt = new Date().toISOString();
    this.setConnectionState("connected");
  }

  private async applyServerChanges(pull: SyncPullResponse): Promise<void> {
    // Update version vector
    if (pull.serverClock > 0) {
      this.state.versionVector["server"] = pull.serverClock;
      this.saveVersionVector();
    }

    // Apply each server change to local state
    for (const change of pull.changes) {
      if (change.operation === "delete") {
        if (this.localDb) {
          this.localDb.run(
            `DELETE FROM _local_records WHERE collection = ? AND row_id = ?`,
            [change.collection, change.rowId]
          );
        }
        continue;
      }

      // For insert/update, apply to local cache
      if (change.newValue) {
        const localChange = this.state.pendingChanges.find(
          (c: ChangeLogEntry) => c.rowId === change.rowId && c.field === change.field
        );

        if (localChange) {
          // Conflict detected
          const merged = await this.resolveConflict(localChange, change);
          this.cacheRecord(change.collection, change.rowId, merged);
        } else {
          const existing = this.getCachedRecord(change.collection, change.rowId) ?? {};
          const updated = { ...existing };
          if (typeof change.newValue === "object" && change.newValue !== null) {
            Object.assign(updated, change.newValue);
          } else {
            updated[change.field ?? "value"] = change.newValue;
          }
          this.cacheRecord(change.collection, change.rowId, updated);
        }
      }
    }
  }

  private async resolveConflict(
    local: ChangeLogEntry,
    server: ChangeLogEntry
  ): Promise<Record<string, unknown>> {
    const localVal = local.newValue ?? {};
    const serverVal = server.newValue ?? {};

    if (this.options.onConflict) {
      try {
        const resolved = await this.options.onConflict(
          typeof localVal === "object" ? (localVal as Record<string, unknown>) : { value: localVal },
          typeof serverVal === "object" ? (serverVal as Record<string, unknown>) : { value: serverVal },
          "server-wins"
        );
        return resolved;
      } catch (err) {
        console.warn("Conflict resolver failed, defaulting to server-wins:", err);
      }
    }

    // Default behavior: server-wins
    return typeof serverVal === "object" ? (serverVal as Record<string, unknown>) : { value: serverVal };
  }
}

/**
 * Create a sync engine for offline-first support.
 */
export function enableSync(client: BoltstoreClient, options: SyncOptions): SyncEngine {
  const engine = new SyncEngine(client, options);
  if (options.autoStart !== false) {
    engine.start();
  }
  return engine;
}
