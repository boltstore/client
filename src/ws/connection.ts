import type { ConnectionState, ReconnectConfig } from "@boltstore/utils";

const DEFAULT_RECONNECT: ReconnectConfig = {
  strategy: "exponential",
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxRetries: 10,
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export type MessageHandler = (data: unknown) => void;
export type StateChangeHandler = (state: ConnectionState) => void;

export class RealtimeConnection {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private stateChangeHandlers: StateChangeHandler[] = [];
  private messageHandlers: MessageHandler[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private pendingMessages: string[] = [];

  private url: string;
  private databaseId: string | undefined;
  private getToken: () => string | undefined;
  private reconnectConfig: ReconnectConfig;
  private heartbeatIntervalMs: number;

  constructor(
    url: string,
    getToken: () => string | undefined,
    options?: {
      databaseId?: string;
      reconnect?: Partial<ReconnectConfig>;
      heartbeatIntervalMs?: number;
    }
  ) {
    this.url = url.replace(/\/$/, "");
    this.getToken = getToken;
    this.databaseId = options?.databaseId;
    this.reconnectConfig = { ...DEFAULT_RECONNECT, ...options?.reconnect };
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.push(handler);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closed = false;
    this.setState("connecting");

    const params = new URLSearchParams();
    const token = this.getToken();
    if (token) params.set("token", token);
    if (this.databaseId) params.set("db", this.databaseId);

    const wsUrl = `${this.url}/ws?${params.toString()}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startHeartbeat();
      this.flushPending();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (data && typeof data === "object" && "type" in (data as Record<string, unknown>)) {
        const msg = data as { type: string };
        if (msg.type === "pong") {
          this.clearHeartbeatTimeout();
          return;
        }
      }
      for (const handler of this.messageHandlers) {
        handler(data);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      this.ws = null;
      if (this.closed) {
        this.setState("disconnected");
        return;
      }
      if (event.code === 4001 && this.getToken()) {
        this.setState("disconnected");
        this.scheduleReconnect();
        return;
      }
      this.setState("reconnecting");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so we handle reconnect there
    };
  }

  disconnect(): void {
    this.closed = true;
    this.cancelReconnect();
    this.stopHeartbeat();
    this.pendingMessages = [];
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000);
      }
      this.ws = null;
    }
    this.setState("disconnected");
  }

  reconnect(): void {
    this.cancelReconnect();
    this.stopHeartbeat();
    this.pendingMessages = [];
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000);
      }
      this.ws = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  send(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(data);
    }
  }

  private flushPending(): void {
    for (const msg of this.pendingMessages) {
      this.ws?.send(msg);
    }
    this.pendingMessages = [];
  }

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const handler of this.stateChangeHandlers) {
      handler(newState);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.ws?.close(4000, "Heartbeat timeout");
      }, HEARTBEAT_TIMEOUT_MS);
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer && typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      (this.heartbeatTimer as { unref(): void }).unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer !== null) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectAttempts >= this.reconnectConfig.maxRetries) {
      this.setState("disconnected");
      return;
    }
    this.reconnectAttempts++;
    const delay = this.computeDelay(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private computeDelay(attempt: number): number {
    if (this.reconnectConfig.strategy === "fixed") {
      return this.reconnectConfig.initialDelayMs;
    }
    const delay = this.reconnectConfig.initialDelayMs * Math.pow(2, attempt - 1);
    return Math.min(delay, this.reconnectConfig.maxDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
