import { generateSecureId, type RecordEvent, type ConnectionState } from "@boltstore/utils";

export type EventCallback = (event: RecordEvent) => void;
export type ErrorCallback = (error: { code: string; message: string }) => void;

export interface SubscribeOptions {
  recordId?: string;
  filter?: Record<string, unknown>;
  onEvent: EventCallback;
  onError?: ErrorCallback;
}

interface PendingSubscription {
  collection: string;
  recordId?: string;
  filter?: Record<string, unknown>;
  onEvent: EventCallback;
  onError?: ErrorCallback;
  localId: string;
  createdAt: number;
}

interface ActiveSubscription {
  subscriptionId: string;
  collection: string;
  recordId?: string;
  filter?: Record<string, unknown>;
  onEvent: EventCallback;
  onError?: ErrorCallback;
}

const PENDING_TIMEOUT_MS = 15_000;

export class SubscriptionManager {
  private pending: Map<string, PendingSubscription> = new Map();
  private active: Map<string, ActiveSubscription> = new Map();
  private localToServer: Map<string, string> = new Map();
  private serverToLocal: Map<string, string> = new Map();
  private send: (msg: Record<string, unknown>) => void;
  private pendingCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  constructor(
    send: (msg: Record<string, unknown>) => void,
    onMessage: (handler: (data: unknown) => void) => void,
    onStateChange: (handler: (state: ConnectionState) => void) => void,
  ) {
    this.send = send;

    const msgHandler = (data: unknown): void => {
      if (!data || typeof data !== "object") return;
      const msg = data as Record<string, unknown>;
      if (msg.type === "subscribed" && typeof msg.subscriptionId === "string") {
        this.handleSubscribed(msg.subscriptionId as string, msg.localId as string | undefined);
      } else if (msg.type === "event") {
        this.handleEvent(data as RecordEvent);
      } else if (msg.type === "error") {
        this.handleError(data as { code?: string; message?: string });
      }
    };
    onMessage(msgHandler);

    onStateChange((state: ConnectionState) => {
      if (state === "connected" && !this.connected) {
        this.connected = true;
        this.resubscribeAll();
      } else if (state === "disconnected" || state === "reconnecting") {
        this.connected = false;
      }
    });

    this.startPendingCleanup();
  }

  private startPendingCleanup(): void {
    if (this.pendingCleanupTimer) return;
    this.pendingCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [localId, pending] of this.pending) {
        if (now - pending.createdAt > PENDING_TIMEOUT_MS) {
          this.pending.delete(localId);
        }
      }
    }, 5_000);
  }

  subscribe(collection: string, options: SubscribeOptions): string {
    const localId = generateSecureId("sub");
    const pending: PendingSubscription = {
      collection,
      recordId: options.recordId,
      filter: options.filter,
      onEvent: options.onEvent,
      onError: options.onError,
      localId,
      createdAt: Date.now(),
    };
    this.pending.set(localId, pending);

    const msg: Record<string, unknown> = { type: "subscribe", collection, localId };
    if (options.recordId) msg.recordId = options.recordId;
    if (options.filter) msg.filter = options.filter;
    this.send(msg);

    return localId;
  }

  unsubscribe(subscriptionId: string): void {
    const serverId = this.localToServer.get(subscriptionId) ?? subscriptionId;
    const active = this.active.get(serverId);
    if (active) {
      this.send({ type: "unsubscribe", subscriptionId: serverId });
      this.active.delete(serverId);
      this.localToServer.delete(subscriptionId);
      this.serverToLocal.delete(serverId);
      return;
    }
    for (const [localId, pending] of this.pending) {
      if (pending.localId === subscriptionId) {
        this.pending.delete(localId);
        return;
      }
    }
  }

  unsubscribeAll(): void {
    for (const [id] of this.active) {
      this.send({ type: "unsubscribe", subscriptionId: id });
    }
    this.active.clear();
    this.pending.clear();
    this.localToServer.clear();
    this.serverToLocal.clear();
  }

  getActiveSubscriptions(): Array<{
    subscriptionId: string;
    collection: string;
    recordId?: string;
    filter?: Record<string, unknown>;
  }> {
    const result: Array<{
      subscriptionId: string;
      collection: string;
      recordId?: string;
      filter?: Record<string, unknown>;
    }> = [];
    for (const sub of this.active.values()) {
      result.push({
        subscriptionId: sub.subscriptionId,
        collection: sub.collection,
        recordId: sub.recordId,
        filter: sub.filter,
      });
    }
    for (const sub of this.pending.values()) {
      result.push({
        subscriptionId: sub.localId,
        collection: sub.collection,
        recordId: sub.recordId,
        filter: sub.filter,
      });
    }
    return result;
  }

  private handleSubscribed(serverSubscriptionId: string, localId?: string): void {
    if (!localId || !this.pending.has(localId)) return;
    const pending = this.pending.get(localId)!;
    this.pending.delete(localId);
    this.localToServer.set(localId, serverSubscriptionId);
    this.serverToLocal.set(serverSubscriptionId, localId);
    const active: ActiveSubscription = {
      subscriptionId: serverSubscriptionId,
      collection: pending.collection,
      recordId: pending.recordId,
      filter: pending.filter,
      onEvent: pending.onEvent,
      onError: pending.onError,
    };
    this.active.set(serverSubscriptionId, active);
  }

  private handleEvent(event: RecordEvent): void {
    for (const sub of this.active.values()) {
      if (sub.collection && sub.collection !== event.collection) continue;
      if (sub.recordId && sub.recordId !== (event.record.id as string)) continue;
      if (sub.filter && !this.matchesFilter(event.record, sub.filter)) continue;
      sub.onEvent(event);
    }
  }

  private handleError(error: { code?: string; message?: string }): void {
    for (const sub of this.active.values()) {
      sub.onError?.({ code: error.code ?? "UNKNOWN", message: error.message ?? "Unknown error" });
    }
  }

  private resubscribeAll(): void {
    const subsToRestore = [...this.active.values()];
    this.active.clear();
    this.localToServer.clear();
    this.serverToLocal.clear();
    for (const sub of subsToRestore) {
      const localId = generateSecureId("sub");
      const pending: PendingSubscription = {
        collection: sub.collection,
        recordId: sub.recordId,
        filter: sub.filter,
        onEvent: sub.onEvent,
        onError: sub.onError,
        localId,
        createdAt: Date.now(),
      };
      this.pending.set(localId, pending);

      const msg: Record<string, unknown> = { type: "subscribe", collection: sub.collection, localId };
      if (sub.recordId) msg.recordId = sub.recordId;
      if (sub.filter) msg.filter = sub.filter;
      this.send(msg);
    }
  }

  private matchesFilter(record: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (record[key] !== value) return false;
    }
    return true;
  }
}
