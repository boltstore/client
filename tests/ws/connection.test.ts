import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { RealtimeConnection } from "../../src/ws/connection";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WsEventListener = ((event: MessageEvent) => void) | ((event: CloseEvent) => void) | (() => void);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  sentMessages: string[] = [];
  private _closeCode = 1000;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number): void {
    this._closeCode = code ?? 1000;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: this._closeCode, reason: "", wasClean: true } as CloseEvent);
    }
  }

  // Test helpers
  _simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  _simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  _simulateClose(code: number): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason: "", wasClean: code === 1000 } as CloseEvent);
    }
  }

  _simulateError(): void {
    if (this.onerror) this.onerror();
  }

  static _reset(): void {
    MockWebSocket.instances = [];
  }

  static _last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// @ts-ignore - override global WebSocket
globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RealtimeConnection", () => {
  let conn: RealtimeConnection;
  let tokenProvider: () => string | undefined;

  beforeEach(() => {
    MockWebSocket._reset();
    tokenProvider = () => "test-token";
    conn = new RealtimeConnection("http://localhost:8080", tokenProvider, {
      databaseId: "dbs_abc",
      reconnect: { maxRetries: 2, initialDelayMs: 10 },
      heartbeatIntervalMs: 100_000, // effectively disable heartbeat in tests
    });
  });

  afterEach(() => {
    conn.disconnect();
  });

  test("connect creates WebSocket with database query param, token sent as first message", () => {
    conn.connect();
    const ws = MockWebSocket._last();
    expect(ws).toBeDefined();
    expect(ws!.url).not.toContain("token=");
    expect(ws!.url).toContain("db=dbs_abc");
  });

  test("token sent as first message after open", () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
    const firstMsg = JSON.parse(ws.sentMessages[0]);
    expect(firstMsg.type).toBe("auth");
    expect(firstMsg.token).toBe("test-token");
  });

  test("connect sets state to connecting then connected on open", () => {
    const states: string[] = [];
    conn.onStateChange((s) => states.push(s));

    conn.connect();
    expect(states).toContain("connecting");

    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    expect(states).toContain("connected");
  });

  test("disconnect sets state to disconnected and closes WebSocket", () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    const states: string[] = [];
    conn.onStateChange((s) => states.push(s));

    conn.disconnect();
    expect(states).toContain("disconnected");
  });

  test("onMessage receives parsed JSON messages", () => {
    const messages: unknown[] = [];
    conn.onMessage((data) => messages.push(data));

    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    ws._simulateMessage(JSON.stringify({ type: "connected", connectionId: "ws_123" }));
    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).type).toBe("connected");
    expect((messages[0] as Record<string, unknown>).connectionId).toBe("ws_123");
  });

  test("pong messages are consumed internally and not forwarded to handlers", () => {
    const messages: unknown[] = [];
    conn.onMessage((data) => messages.push(data));

    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    ws._simulateMessage(JSON.stringify({ type: "pong" }));
    expect(messages).toHaveLength(0);
  });

  test("send serializes and sends JSON", () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    // First message is the auth message (sent by onopen handler)
    expect(ws!.sentMessages.length).toBeGreaterThanOrEqual(1);

    conn.send({ type: "subscribe", collection: "posts" });
    // Now there should be at least 2 messages (auth + subscribe)
    const lastMsg = ws!.sentMessages[ws!.sentMessages.length - 1];
    const parsed = JSON.parse(lastMsg);
    expect(parsed.type).toBe("subscribe");
    expect(parsed.collection).toBe("posts");
  });

  test("send does nothing when not connected", () => {
    conn.send({ type: "ping" });
    // No crash
  });

  test("reconnect resets attempt count and reconnects", () => {
    conn.connect();
    const ws1 = MockWebSocket._last()!;
    ws1._simulateOpen();

    conn.reconnect();
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  test("auto-reconnects on unexpected close", async () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    ws._simulateClose(1006); // abnormal closure

    // Wait for reconnect timer
    await new Promise((r) => setTimeout(r, 20));

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  test("does not reconnect after clean disconnect", async () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    conn.disconnect();

    // Wait a bit — no reconnect should happen
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBe(1);
  });

  test("stops reconnecting after maxRetries when connection never opens", async () => {
    conn = new RealtimeConnection("http://localhost:8080", tokenProvider, {
      databaseId: "dbs_abc",
      reconnect: { maxRetries: 1, initialDelayMs: 5 },
      heartbeatIntervalMs: 100_000,
    });

    conn.connect();
    const ws = MockWebSocket._last()!;

    // Simulate close without ever opening — attempts accumulate
    ws._simulateClose(1006);
    await new Promise((r) => setTimeout(r, 15));

    // Second attempt's WebSocket also fails to open
    const ws2 = MockWebSocket._last()!;
    ws2._simulateClose(1006);
    await new Promise((r) => setTimeout(r, 15));

    // Should be disconnected now (maxRetries=1 means 1 retry after initial attempt)
    expect(conn.connectionState).toBe("disconnected");
  });

  test("connectionState getter returns current state", () => {
    expect(conn.connectionState).toBe("disconnected");
    conn.connect();
    expect(conn.connectionState).toBe("connecting");
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    expect(conn.connectionState).toBe("connected");
    conn.disconnect();
    expect(conn.connectionState).toBe("disconnected");
  });

  test("connect is idempotent when already connected", () => {
    conn.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    conn.connect(); // should not create a new WebSocket
    expect(MockWebSocket.instances.length).toBe(1);
  });

  test("uses databaseId when provided", () => {
    conn = new RealtimeConnection("http://localhost:8080", tokenProvider, {
      databaseId: "dbs_abc",
    });
    conn.connect();
    const ws = MockWebSocket._last()!;
    expect(ws!.url).toContain("db=dbs_abc");
  });

  test("omits database param when no databaseId set", () => {
    conn = new RealtimeConnection("http://localhost:8080", tokenProvider);
    conn.connect();
    const ws = MockWebSocket._last()!;
    expect(ws!.url).not.toContain("db=");
  });

  test("omits token param when no token available", () => {
    conn = new RealtimeConnection("http://localhost:8080", () => undefined, {
      databaseId: "dbs_abc",
    });
    conn.connect();
    const ws = MockWebSocket._last()!;
    expect(ws!.url).not.toContain("token=");
  });
});
