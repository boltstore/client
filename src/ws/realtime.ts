import type { ConnectionState, RecordEvent } from "@boltstore/utils";
import { RealtimeConnection } from "./connection";
import { SubscriptionManager, type SubscribeOptions } from "./subscription";

export type { SubscribeOptions } from "./subscription";

export type SubscribeCallback = (event: RecordEvent) => void;
export type LifecycleCallback = () => void;

export class Realtime {
  private connection: RealtimeConnection;
  private subscriptions: SubscriptionManager;
  private connectedHandlers: LifecycleCallback[] = [];
  private disconnectedHandlers: LifecycleCallback[] = [];

  constructor(
    url: string,
    getToken: () => string | undefined,
    options?: {
      databaseId?: string;
      database?: string;
      reconnect?: { strategy?: "exponential" | "fixed"; initialDelayMs?: number; maxDelayMs?: number; maxRetries?: number };
      heartbeatIntervalMs?: number;
    }
  ) {
    this.connection = new RealtimeConnection(url, getToken, options);
    this.subscriptions = new SubscriptionManager(
      (msg) => this.connection.send(msg),
      (handler) => this.connection.onMessage(handler),
      (handler) => this.connection.onStateChange(handler),
    );

    this.connection.onStateChange((state: ConnectionState) => {
      if (state === "connected") {
        for (const h of this.connectedHandlers) h();
      } else if (state === "disconnected") {
        for (const h of this.disconnectedHandlers) h();
      }
    });
  }

  get connectionState(): ConnectionState {
    return this.connection.connectionState;
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  close(): void {
    this.subscriptions.unsubscribeAll();
    this.connection.disconnect();
    this.connectedHandlers = [];
    this.disconnectedHandlers = [];
  }

  onConnected(callback: LifecycleCallback): void {
    this.connectedHandlers.push(callback);
  }

  onDisconnected(callback: LifecycleCallback): void {
    this.disconnectedHandlers.push(callback);
  }

  subscribe(collection: string, callback: SubscribeCallback): () => void;
  subscribe(collection: string, options: SubscribeOptions & { onEvent: SubscribeCallback }): () => void;
  subscribe(collection: string, optionsOrCallback: SubscribeCallback | (SubscribeOptions & { onEvent: SubscribeCallback })): () => void {
    let opts: SubscribeOptions;
    if (typeof optionsOrCallback === "function") {
      opts = { onEvent: optionsOrCallback };
    } else {
      opts = optionsOrCallback;
    }

    if (this.connection.connectionState === "disconnected") {
      this.connection.connect();
    }

    const subId = this.subscriptions.subscribe(collection, opts);

    return () => {
      this.subscriptions.unsubscribe(subId);
    };
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.unsubscribe(subscriptionId);
  }

  unsubscribeAll(): void {
    this.subscriptions.unsubscribeAll();
  }
}
