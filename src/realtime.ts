// ── Realtime Module ──
// WebSocket-based realtime subscriptions.

import type { BoltstoreClient } from "./client";
import type { RealtimeEvent, RealtimeTopic, ClientMessage, ServerMessage } from "@boltstore/shared";

export type RealtimeCallback = (event: RealtimeEvent) => void;

export interface Subscription {
  /** Unique subscription ID */
  id: string;
  /** Topic string */
  topic: string;
  /** Callback to invoke on events */
  callback: RealtimeCallback;
}

/**
 * Realtime client — manages WebSocket connection and subscriptions.
 * Created by `connectRealtime()`.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private client: BoltstoreClient;
  private subscriptions: Map<string, Subscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private onConnectCallbacks: Array<() => void> = [];
  private onDisconnectCallbacks: Array<() => void> = [];

  constructor(client: BoltstoreClient) {
    this.client = client;
  }

  // ── Connection ──

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Replace http:// with ws:// and https:// with wss://
    const baseUrl = (this.client as any).config?.url ?? "http://localhost:8090";
    const wsUrl = baseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:") + "/ws";

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Authenticate the WebSocket
      if ((this.client as any).authState?.token) {
        this.ws!.send(JSON.stringify({
          type: "auth",
          token: (this.client as any).authState.token,
        }));
      }
      // Re-subscribe to existing topics
      for (const sub of this.subscriptions.values()) {
        this.ws!.send(JSON.stringify({ type: "subscribe", topic: sub.topic }));
      }
      // Fire connect callbacks
      for (const cb of this.onConnectCallbacks) cb();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data.toString());

        if (msg.type === "event") {
          // Route to the correct subscription callback
          for (const sub of this.subscriptions.values()) {
            if (topicMatches(sub.topic, msg.collection, msg.record)) {
              sub.callback(msg as RealtimeEvent);
            }
          }
        } else if (msg.type === "error") {
          console.error("Realtime error:", msg.message);
        }
        // subscribed, unsubscribed, pong — handled internally
      } catch {
        // Ignore non-JSON messages
      }
    };

    this.ws.onclose = () => {
      for (const cb of this.onDisconnectCallbacks) cb();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will be called after this
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  // ── Subscriptions ──

  /**
   * Subscribe to events on a table (collection).
   *
   * @example
   * const unsub = realtime.subscribe("table:app_123:todos", (event) => {
   *   console.log(event.type, event.record);
   * });
   */
  subscribe(topic: string, callback: RealtimeCallback): () => void {
    const id = `sub_${crypto.randomUUID()}`;
    const sub: Subscription = { id, topic, callback };
    this.subscriptions.set(id, sub);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", topic }));
    }

    // Return unsubscribe function
    return () => this.unsubscribe(id);
  }

  /**
   * Unsubscribe from a topic by subscription ID.
   */
  unsubscribe(id: string): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;

    this.subscriptions.delete(id);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", topic: sub.topic }));
    }
  }

  // ── Events ──

  onConnect(cb: () => void): () => void {
    this.onConnectCallbacks.push(cb);
    return () => {
      const idx = this.onConnectCallbacks.indexOf(cb);
      if (idx >= 0) this.onConnectCallbacks.splice(idx, 1);
    };
  }

  onDisconnect(cb: () => void): () => void {
    this.onDisconnectCallbacks.push(cb);
    return () => {
      const idx = this.onDisconnectCallbacks.indexOf(cb);
      if (idx >= 0) this.onDisconnectCallbacks.splice(idx, 1);
    };
  }

  /** Whether the WebSocket is connected */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Connect to the realtime WebSocket and return a RealtimeClient.
 */
export function connectRealtime(client: BoltstoreClient): RealtimeClient {
  const rt = new RealtimeClient(client);
  rt.connect();
  return rt;
}

/**
 * Simple topic matching.
 * "table:app:collection" matches events for that collection.
 * "row:app:collection:id" matches events for that specific record.
 */
function topicMatches(topic: string, collection: string, record: Record<string, unknown>): boolean {
  const parts = topic.split(":");
  if (parts[0] === "table") {
    return parts[2] === collection;
  }
  if (parts[0] === "row") {
    return parts[2] === collection && parts[3] === String(record.id);
  }
  return false;
}
