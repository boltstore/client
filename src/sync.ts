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
  MergeInput,
  MergeResult,
} from "@boltstore/shared";
import type { SyncStrategy } from "@boltstore/shared";

export interface SyncOptions {
  /** Collections to sync */
  collections: string[];
  /** Called when sync state changes */
  onStateChange?: (state: SyncConnectionState) => void;
  /** Called when a conflict is detected */
  onConflict?: (local: Record<string, unknown>, server: Record<string, unknown>, strategy: SyncStrategy) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Auto-start sync on connection */
  autoStart?: boolean;
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
  }

  // ── State ──

  get connection(): SyncConnectionState {
    return this.connectionState;
  }

  get pendingChangeCount(): number {
    return this.state.pendingChanges.length;
  }

  private setConnectionState(state: SyncConnectionState): void {
    this.connectionState = state;
    this.options.onStateChange?.(state);
  }

  // ── Local Change Tracking ──

  /**
   * Record a local change for later push.
   */
  trackLocalChange(change: Omit<ChangeLogEntry, "id" | "clock" | "clientId" | "timestamp">): void {
    this.state.clock.counter++;

    const entry: ChangeLogEntry = {
      id: `local_${crypto.randomUUID()}`,
      clock: this.state.clock.counter,
      clientId: this.state.clock.nodeId,
      timestamp: new Date().toISOString(),
      ...change,
    };

    this.state.pendingChanges.push(entry);
  }

  // ── Sync Operations ──

  /**
   * Start the sync connection.
   */
  async start(): Promise<void> {
    this.setConnectionState("connecting");

    const baseUrl = (this.client as any).config?.url ?? "";
    const wsUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/ws";

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = async () => {
      this.setConnectionState("connected");

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
      }
    };

    this.ws.onclose = () => {
      this.setConnectionState("disconnected");
      // Schedule reconnect
      setTimeout(() => this.start(), 5000);
    };
  }

  /**
   * Stop the sync connection.
   */
  stop(): void {
    this.ws?.close();
    this.ws = null;
    this.setConnectionState("disconnected");
  }

  // ── Internal ──

  private async pushChanges(): Promise<void> {
    if (this.state.pendingChanges.length === 0) return;

    this.setConnectionState("syncing");
    this.state.syncing = true;

    const pushRequest: SyncPushRequest = {
      type: "sync_push",
      changes: this.state.pendingChanges.map((c) => ({
        rowId: c.rowId,
        collection: c.collection,
        operation: c.operation,
        fields: {
          [c.field ?? "__row__"]: {
            field: c.field ?? "__row__",
            value: c.newValue,
            clock: c.clock,
            clientId: c.clientId,
          },
        },
      })),
    };

    this.ws!.send(JSON.stringify(pushRequest));
  }

  private handlePushResponse(response: SyncPushResponse): void {
    // Remove accepted changes from pending queue
    const acceptedSet = new Set(response.accepted);
    this.state.pendingChanges = this.state.pendingChanges.filter(
      (c) => !acceptedSet.has(c.id)
    );

    // Update version vector with server's response
    this.state.versionVector["server"] = Math.max(
      this.state.versionVector["server"] ?? 0,
      this.state.clock.counter
    );

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
    }

    // Apply each server change to local state
    for (const change of pull.changes) {
      // If we have a conflict, resolve it
      const localChange = this.state.pendingChanges.find(
        (c) => c.rowId === change.rowId && c.field === change.field
      );

      if (localChange) {
        // Conflict detected
        const merged = await this.resolveConflict(localChange, change);
        // TODO: Apply merged result to local store
        if (this.options.onConflict) {
          // Notify the app about the conflict
        }
      }

      // TODO: Apply change to local database
    }
  }

  private async resolveConflict(
    local: ChangeLogEntry,
    server: ChangeLogEntry
  ): Promise<Record<string, unknown>> {
    // Default: use the configured strategy
    if (this.options.onConflict) {
      return this.options.onConflict(
        { [local.field ?? "value"]: local.newValue },
        { [server.field ?? "value"]: server.newValue },
        "server-wins" // default strategy
      );
    }

    // Default behavior: server-wins
    return { [server.field ?? "value"]: server.newValue };
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
