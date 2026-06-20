import type { BoltstoreClient } from "../client";
import { BoltstoreError } from "../errors";

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
}

export interface SyncStatus {
  running: boolean;
  lastCursor: number | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  pendingPushes: number;
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

const DEFAULT_INTERVAL_MS = 30_000;

export class SyncManager {
  private client: BoltstoreClient;
  private config: Required<SyncConfig>;
  private running = false;
  private _lastCursor: number | null = null;
  private _lastPullAt: string | null = null;
  private _lastPushAt: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimeoutMs: number;

  constructor(client: BoltstoreClient, config?: SyncConfig) {
    this.client = client;
    this.config = {
      clientId: config?.clientId ?? "default",
      collections: config?.collections ?? [],
      intervalMs: config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      onPull: config?.onPull ?? (() => {}),
      onPush: config?.onPush ?? (() => {}),
      onError: config?.onError ?? (() => {}),
      onConflict: config?.onConflict ?? (async () => {}),
    };
    this.pollTimeoutMs = Math.max(this.config.intervalMs, 5000);
  }

  get lastCursor(): number | null {
    return this._lastCursor;
  }

  get running(): boolean {
    return this.running;
  }

  status(): SyncStatus {
    return {
      running: this.running,
      lastCursor: this._lastCursor,
      lastPullAt: this._lastPullAt,
      lastPushAt: this._lastPushAt,
      pendingPushes: 0,
    };
  }

  async start(config?: { collections?: string[]; intervalMs?: number }): Promise<void> {
    if (config?.collections) this.config.collections = config.collections;
    if (config?.intervalMs) {
      this.config.intervalMs = config.intervalMs;
      this.pollTimeoutMs = Math.max(config.intervalMs, 5000);
    }

    this.running = true;

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
      this.config.onPull(res.data);
    }

    return res.data!;
  }

  async push(operations: SyncPushOperation[]): Promise<SyncPushResult> {
    const res = await this.client.request<SyncPushResult>("POST", this.client.dbPath("/sync/push"), {
      operations,
      clientId: this.config.clientId,
    });

    this._lastPushAt = new Date().toISOString();

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
        this.config.onError(error);
      }

      if (this.running) {
        this.scheduleNextPull();
      }
    }, this.pollTimeoutMs);
  }
}
