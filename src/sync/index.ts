import type { BoltstoreClient } from "../client";
import type { LocalStore } from "../store/types";
import { BoltstoreError } from "../errors";
import { InMemoryStore, type SyncStore } from "./store";

export { InMemoryStore, type SyncStore, createWebStore } from "./store";

export interface SyncConfig {
  clientId?: string;
  /** Called when queued operations exhaust their retries. */
  onQueueError?: (error: Error, operations: SyncPushOperation[]) => void;
  /** Max retry attempts per queued operation. Default: 3. */
  maxQueueRetries?: number;
  /** Persistence store for the offline queue. Default: InMemoryStore (volatile). */
  store?: SyncStore;
}

export interface SyncPushResult {
  ok: boolean;
  results: SyncPushOperationResult[];
}

export interface SyncPushOperation {
  event: "create" | "update" | "delete";
  collection: string;
  id?: string;
  data?: Record<string, unknown>;
}

export interface SyncPushOperationResult {
  event: string;
  collection: string;
  id: string | null;
  status: string;
  error?: string;
}

interface QueuedOperation {
  operation: SyncPushOperation;
  retries: number;
  error?: string;
}

const QUEUE_KEY = "sync_queue";

export class SyncManager {
  private client: BoltstoreClient;
  private config: Required<SyncConfig>;
  private _isOnline = true;
  private queue: QueuedOperation[] = [];
  private store: SyncStore;
  private flushInProgress = false;
  private eventCleanup: (() => void) | null = null;
  localStore: LocalStore | null = null;

  constructor(client: BoltstoreClient, config?: SyncConfig) {
    this.client = client;
    this.store = config?.store ?? new InMemoryStore();
    this.localStore = client.localStore;
    this.config = {
      clientId: config?.clientId ?? "default",
      onQueueError: config?.onQueueError ?? (() => {}),
      maxQueueRetries: config?.maxQueueRetries ?? 3,
      store: this.store,
    };
    this.restoreQueue().catch(() => {});
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  async push(operations: SyncPushOperation[]): Promise<SyncPushResult> {
    try {
      const res = await this.client.request<SyncPushResult>("POST", this.client.dbPath("/sync/push"), {
        operations,
        clientId: this.config.clientId,
      });
      this.setOnline(true);
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
          }
          if (item.retries < this.config.maxQueueRetries) {
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

  setOnline(online: boolean): void {
    const was = this._isOnline;
    this._isOnline = online;
    if (online && !was) {
      this.flushQueue().catch(() => {});
    }
  }

  listenForOnline(): void {
    if (typeof window === "undefined" || typeof window.addEventListener === "undefined") return;

    const onWindowOnline = () => { this.setOnline(true); };
    const onWindowOffline = () => { this.setOnline(false); };

    window.addEventListener("online", onWindowOnline);
    window.addEventListener("offline", onWindowOffline);

    this.eventCleanup = () => {
      window.removeEventListener("online", onWindowOnline);
      window.removeEventListener("offline", onWindowOffline);
    };
  }

  unlistenForOnline(): void {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
  }
}
