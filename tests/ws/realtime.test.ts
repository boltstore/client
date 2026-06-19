import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Realtime } from "../../src/ws/realtime";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

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

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000, reason: "", wasClean: true } as CloseEvent);
    }
  }

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

  static _reset(): void {
    MockWebSocket.instances = [];
  }

  static _last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// @ts-ignore
globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Realtime", () => {
  let realtime: Realtime;

  beforeEach(() => {
    MockWebSocket._reset();
    realtime = new Realtime("http://localhost:8080", () => "test-token", {
      databaseId: "dbs_abc",
      heartbeatIntervalMs: 100_000,
    });
  });

  afterEach(() => {
    realtime.close();
  });

  test("connectionState starts as disconnected", () => {
    expect(realtime.connectionState).toBe("disconnected");
  });

  test("connect opens WebSocket connection", () => {
    realtime.connect();
    const ws = MockWebSocket._last();
    expect(ws).toBeDefined();
    expect(ws!.url).toContain("token=test-token");
  });

  test("connect transitions to connected on open", () => {
    const states: string[] = [];
    // Poll state after connect
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    expect(realtime.connectionState).toBe("connected");
  });

  test("disconnect transitions to disconnected", () => {
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    realtime.disconnect();
    expect(realtime.connectionState).toBe("disconnected");
  });

  test("subscribe with callback sends subscribe message", () => {
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    realtime.subscribe("posts", () => {});
    const subMsg = JSON.parse(ws.sentMessages.find((m) => m.includes('"subscribe"')) ?? "{}");
    expect(subMsg.type).toBe("subscribe");
    expect(subMsg.collection).toBe("posts");
  });

  test("subscribe with callback returns unsubscribe function", () => {
    const unsub = realtime.subscribe("posts", () => {});
    expect(typeof unsub).toBe("function");
  });

  test("subscribe with options sends recordId and filter", () => {
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    realtime.subscribe("posts", {
      recordId: "rec_123",
      filter: { status: "published" },
      onEvent: () => {},
    });
    const subMsg = JSON.parse(ws.sentMessages.find((m) => m.includes('"subscribe"')) ?? "{}");
    expect(subMsg.recordId).toBe("rec_123");
    expect(subMsg.filter.status).toBe("published");
  });

  test("subscribe auto-connects when disconnected", () => {
    expect(realtime.connectionState).toBe("disconnected");
    realtime.subscribe("posts", () => {});
    const ws = MockWebSocket._last();
    expect(ws).toBeDefined();
  });

  test("unsubscribeAll sends unsubscribe for all subscriptions", () => {
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    realtime.subscribe("posts", () => {});
    const sub1 = JSON.parse(ws.sentMessages.find((m) => m.includes('"subscribe"')) ?? "{}");
    ws._simulateMessage(JSON.stringify({ type: "subscribed", subscriptionId: "sub_1", localId: sub1.localId }));
    realtime.subscribe("comments", () => {});
    const sub2 = JSON.parse(ws.sentMessages.filter((m) => m.includes('"subscribe"')).pop() ?? "{}");
    ws._simulateMessage(JSON.stringify({ type: "subscribed", subscriptionId: "sub_2", localId: sub2.localId }));
    ws.sentMessages.length = 0;

    realtime.unsubscribeAll();

    const unsubCount = ws.sentMessages.filter((m) => m.includes('"unsubscribe"')).length;
    expect(unsubCount).toBe(2);
  });

  test("close disconnects and clears all state", () => {
    realtime.subscribe("posts", () => {});
    realtime.close();
    expect(realtime.connectionState).toBe("disconnected");
  });

  test("onConnected fires when connection opens", () => {
    let fired = false;
    realtime.onConnected(() => { fired = true; });
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    expect(fired).toBe(true);
  });

  test("onDisconnected fires when connection closes", () => {
    let fired = false;
    realtime.onDisconnected(() => { fired = true; });
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();
    realtime.disconnect();
    expect(fired).toBe(true);
  });

  test("incoming event dispatches to subscription callback", () => {
    const events: unknown[] = [];
    realtime.subscribe("posts", (e) => events.push(e));

    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    // Simulate server ack with localId
    const subMsg = JSON.parse(ws.sentMessages.find((m) => m.includes('"subscribe"')) ?? "{}");
    ws._simulateMessage(JSON.stringify({ type: "subscribed", subscriptionId: "sub_1", localId: subMsg.localId }));

    // Simulate event
    ws._simulateMessage(JSON.stringify({
      type: "event",
      event: "create",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_1", title: "Hello" },
    }));

    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).event).toBe("create");
  });

  test("unsubscribe function removes subscription", () => {
    const events: unknown[] = [];
    realtime.connect();
    const ws = MockWebSocket._last()!;
    ws._simulateOpen();

    const unsub = realtime.subscribe("posts", (e) => events.push(e));
    ws._simulateMessage(JSON.stringify({ type: "subscribed", subscriptionId: "sub_1" }));

    unsub();

    ws._simulateMessage(JSON.stringify({
      type: "event",
      event: "create",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_1" },
    }));

    expect(events).toHaveLength(0);
  });
});
