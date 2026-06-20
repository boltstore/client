import type { BoltstoreClient } from "../client";
import { BoltstoreError } from "../errors";
import { InMemoryStore, type SyncStore } from "./store";

export { InMemoryStore, type SyncStore, createWebStore, createFileStore } from "./store";

export interface SyncConflict {
  operation: SyncPushOperation;
  serverVersion: Record<string, unknown>;
  clientVersion: Record<string, unknown>;
  strategy: string;
}

export interface SyncConfig {
  clientId?: string;
  collections?: string[];
  intervalMs?: number;
  onPull?: (result: SyncPullResult) => void;
  onPush?: (result: SyncPushResult) => void;
  onError?: (error: Error) => void;
  onConflict?: (conflict: SyncConflict) => Promise<Record<string, unknown> | undefined | void>;
  /** Persistence store for the offline queue. Default: InMemoryStore (lossy across restarts). */
  store?: SyncStore;
  /** Custom online-check function. Default: fetch-success tracking. */
  isOnline?: () => boolean;
  /** Called when connectivity is restored. */
  onOnline?: () => void;
  /** Called when connectivity is lost. */
  onOffline?: () => void;
  /** Called when queued operations exhaust their retries. */
  onQueueError?: (error: Error, operations: SyncPushOperation[]) => void;
  /** Max retry attempts per queued operation. Default: 3. */
  maxQueueRetries?: number;
}

export interface SyncStatus {
  running: boolean;
  lastCursor: number | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  pendingPushes: number;
  queueSize: number;
  isOnline: boolean;
}

export interface SyncPullResult {
  changes: SyncChange[];
  cursor: number | null;
  hasMore: boolean;
}

export interface SyncPushResult {
  ok: boolean;
  results: SyncPushOperationResult[];
}

export interface SyncChange {
  id: string;
  seq: number;
  event: string;
  collection: string;
  recordId: string | null;
  record: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  principalId: string | null;
  createdAt: string;
}

export interface SyncPushOperation {
  event: "create" | "update" | "delete";
  collection: string;
  id?: string;
  data?: Record<string, unknown>;
  baseVersion?: string;
}

export interface SyncPushOperationResult {
  event: string;
  collection: string;
  id: string | null;
  status: string;
  error?: string;
  conflict?: {
    serverVersion: Record<string, unknown>;
    clientVersion: Record<string, unknown>;
    strategy: string;
  };
}

interface QueuedOperation {
  operation: SyncPushOperation;
  retries: number;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;
const QUEUE_KEY = "sync_queue";

export class SyncManager {
  private client: BoltstoreClient;
  private config: Required<SyncConfig>;
  private running = false;
  private _lastCursor: number | null = null;
  private _lastPullAt: string | null = null;
  private _lastPushAt: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimeoutMs: number;
  private _isOnline = true;
  private queue: QueuedOperation[] = [];
  private store: SyncStore;
  private flushInProgress = false;
  private eventCleanup: (() => void) | null = null;

  constructor(client: BoltstoreClient, config?: SyncConfig) {
    this.client = client;
    this.store = config?.store ?? new InMemoryStore();
    this.config = {
      clientId: config?.clientId ?? "default",
      collections: config?.collections ?? [],
      intervalMs: config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      onPull: config?.onPull ?? (() => {}),
      onPush: config?.onPush ?? (() => {}),
      onError: config?.onError ?? (() => {}),
      onConflict: config?.onConflict ?? (async () => {}),
      store: this.store,
      isOnline: config?.isOnline ?? (() => this._isOnline),
      onOnline: config?.onOnline ?? (() => {}),
      onOffline: config?.onOffline ?? (() => {}),
      onQueueError: config?.onQueueError ?? (() => {}),
      maxQueueRetries: config?.maxQueueRetries ?? 3,
    };
    this.pollTimeoutMs = Math.max(this.config.intervalMs, 5000);
  }

  get lastCursor(): number | null {
    return this._lastCursor;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  status(): SyncStatus {
    return {
      running: this.running,
      lastCursor: this._lastCursor,
      lastPullAt: this._lastPullAt,
      lastPushAt: this._lastPushAt,
      pendingPushes: 0,
      queueSize: this.queue.length,
      isOnline: this._isOnline,
    };
  }

  async start(config?: { collections?: string[]; intervalMs?: number }): Promise<void> {
    if (config?.collections) this.config.collections = config.collections;
    if (config?.intervalMs) {
      this.config.intervalMs = config.intervalMs;
      this.pollTimeoutMs = Math.max(config.intervalMs, 5000);
    }

    this.running = true;
    this.listenForOnline();

    try {
      await this.restoreQueue();
    } catch { /* best-effort */ }

    try {
      const serverState = await this.getState();
      if (serverState?.cursor != null) {
        this._lastCursor = serverState.cursor;
      }
    } catch {
      // First sync — no prior state
    }

    this.scheduleNextPull();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.unlistenForOnline();
  }

  async pull(collection?: string): Promise<SyncPullResult> {
    const body: Record<string, unknown> = {
      cursor: this._lastCursor,
    };
    if (collection) body.collection = collection;

    const res = await this.client.request<SyncPullResult>("POST", this.client.dbPath("/sync/pull"), body);

    if (res.data) {
      if (res.data.cursor != null) {
        this._lastCursor = res.data.cursor;
      }

      this._lastPullAt = new Date().toISOString();
      this.setOnline(true);
      this.config.onPull(res.data);
    }

    return res.data!;
  }

  async push(operations: SyncPushOperation[]): Promise<SyncPushResult> {
    try {
      const res = await this.client.request<SyncPushResult>("POST", this.client.dbPath("/sync/push"), {
        operations,
        clientId: this.config.clientId,
      });

      this._lastPushAt = new Date().toISOString();
      this.setOnline(true);

      if (res.data) {
        const conflicts = res.data.results.filter((r) => r.status === "conflict" && r.conflict);
        const rePushOps: SyncPushOperation[] = [];

        for (const result of conflicts) {
          if (!result.conflict) continue;
          const originalOp = operations.find((o) => o.id === result.id && o.collection === result.collection);
          if (!originalOp) continue;

          const conflict: SyncConflict = {
            operation: originalOp,
            serverVersion: result.conflict.serverVersion,
            clientVersion: result.conflict.clientVersion,
            strategy: result.conflict.strategy,
          };

          const merged = await this.config.onConflict(conflict);
          if (merged && result.conflict.strategy === "client-merge" && originalOp.event === "update") {
            rePushOps.push({
              event: "update",
              collection: originalOp.collection,
              id: originalOp.id,
              data: merged,
              baseVersion: result.conflict.serverVersion.updated_at as string | undefined,
            });
          }
        }

        if (rePushOps.length > 0) {
          const retryRes = await this.client.request<SyncPushResult>("POST", this.client.dbPath("/sync/push"), {
            operations: rePushOps,
            clientId: this.config.clientId,
          });
          if (retryRes.data) {
            this._lastPushAt = new Date().toISOString();
            res.data.results = [...res.data.results, ...retryRes.data.results];
          }
        }

        this.config.onPush(res.data);
      }

      return res.data!;
    } catch (err) {
      const isNetworkError = err instanceof BoltstoreError && err.code === "NETWORK_ERROR";
      if (isNetworkError) {
        this.setOnline(false);
        this.enqueue(operations);
        return { ok: false, results: operations.map((op) => ({
          event: op.event,
          collection: op.collection,
          id: op.id ?? null,
          status: "queued",
        }))};
      }
      throw err;
    }
  }

  async flushQueue(): Promise<void> {
    if (this.flushInProgress || this.queue.length === 0) return;
    this.flushInProgress = true;

    try {
      const pending = [...this.queue];
      this.queue = [];
      await this.persistQueue();

      const toRetry: QueuedOperation[] = [];

      for (const item of pending) {
        try {
          await this.client.request<SyncPushResult>("POST", this.client.dbPath("/sync/push"), {
            operations: [item.operation],
            clientId: this.config.clientId,
          });
          this.setOnline(true);
        } catch (err) {
          const isNetwork = err instanceof BoltstoreError && err.code === "NETWORK_ERROR";
          if (isNetwork) {
            this.setOnline(false);
            toRetry.push(item);
          } else if (item.retries < this.config.maxQueueRetries) {
            toRetry.push({ ...item, retries: item.retries + 1, error: err instanceof Error ? err.message : String(err) });
          } else {
            this.config.onQueueError(
              err instanceof Error ? err : new Error(String(err)),
              [item.operation]
            );
          }
        }
      }

      if (toRetry.length > 0) {
        this.queue = toRetry;
        await this.persistQueue();
      }
    } finally {
      this.flushInProgress = false;
    }
  }

  async getState(): Promise<{ clientId: string; cursor: number | null; lastSyncAt: string | null } | null> {
    try {
      const res = await this.client.request<{ clientId: string; cursor: number | null; lastSyncAt: string | null }>(
        "POST",
        this.client.dbPath("/sync/state"),
        { clientId: this.config.clientId }
      );
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  async saveState(): Promise<void> {
    try {
      await this.client.request("POST", this.client.dbPath("/sync/state"), {
        clientId: this.config.clientId,
        cursor: this._lastCursor,
      });
    } catch {
      // Best-effort
    }
  }

  private enqueue(operations: SyncPushOperation[]): void {
    for (const op of operations) {
      this.queue.push({ operation: op, retries: 0 });
    }
    this.persistQueue().catch(() => {});
  }

  private async persistQueue(): Promise<void> {
    const entries = this.queue.map((q) => ({ op: q.operation, retries: q.retries }));
    await this.store.set(QUEUE_KEY, JSON.stringify(entries));
  }

  private async restoreQueue(): Promise<void> {
    const raw = await this.store.get(QUEUE_KEY);
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as { op: SyncPushOperation; retries: number }[];
      this.queue = entries.map((e) => ({ operation: e.op, retries: e.retries }));
    } catch {
      await this.store.remove(QUEUE_KEY);
    }
  }

  private setOnline(online: boolean): void {
    const was = this._isOnline;
    this._isOnline = online;
    if (online && !was) {
      this.config.onOnline();
      this.flushQueue().catch(() => {});
    } else if (!online && was) {
      this.config.onOffline();
    }
  }

  private listenForOnline(): void {
    if (typeof window === "undefined" || typeof window.addEventListener === "undefined") return;

    const onWindowOnline = () => {
      this.setOnline(true);
    };
    const onWindowOffline = () => {
      this.setOnline(false);
    };

    window.addEventListener("online", onWindowOnline);
    window.addEventListener("offline", onWindowOffline);

    this.eventCleanup = () => {
      window.removeEventListener("online", onWindowOnline);
      window.removeEventListener("offline", onWindowOffline);
    };
  }

  private unlistenForOnline(): void {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
  }

  private scheduleNextPull(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      if (!this.running) return;

      try {
        if (this.config.collections.length > 0) {
          for (const col of this.config.collections) {
            if (!this.running) break;
            await this.pull(col);
          }
        } else {
          await this.pull();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.setOnline(false);
        this.config.onError(error);
      }

      try {
        await this.flushQueue();
      } catch { /* best-effort */ }

      if (this.running) {
        this.scheduleNextPull();
      }
    }, this.pollTimeoutMs);
  }
}
