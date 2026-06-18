import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { BoltstoreClient } from "../src/client";
import type { Realtime } from "../src/ws/realtime";

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

  static _reset(): void {
    MockWebSocket.instances = [];
  }

  static _last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// @ts-ignore
globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

describe("BoltstoreClient — realtime integration", () => {
  beforeEach(() => {
    MockWebSocket._reset();
  });

  test("realtime property is lazily instantiated", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    // Accessing realtime should not throw
    const rt: Realtime = client.realtime;
    expect(rt).toBeDefined();
  });

  test("realtime returns the same instance on repeated access", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    const rt1 = client.realtime;
    const rt2 = client.realtime;
    expect(rt1).toBe(rt2);
  });

  test("realtime connects with token from client", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", token: "my-token" });
    client.realtime.connect();
    const ws = MockWebSocket._last()!;
    expect(ws.url).toContain("token=my-token");
  });

  test("realtime connects with databaseId from client", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_abc" });
    client.realtime.connect();
    const ws = MockWebSocket._last()!;
    expect(ws.url).toContain("database=dbs_abc");
  });

  test("realtime config can be passed via ClientConfig", () => {
    const client = new BoltstoreClient({
      baseUrl: "http://localhost:8080",
      databaseId: "dbs_abc",
      realtime: { url: "ws://localhost:8080" },
    });
    client.realtime.connect();
    const ws = MockWebSocket._last()!;
    expect(ws).toBeDefined();
  });

  test("subscribe auto-connects and sends subscribe message", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_abc" });
    client.realtime.subscribe("posts", () => {});
    const ws = MockWebSocket._last()!;
    expect(ws).toBeDefined();
    // Simulate open so the connection can send
    ws._simulateOpen();
    const subMsg = JSON.parse(ws.sentMessages.find((m) => m.includes('"subscribe"')) ?? "{}");
    expect(subMsg.type).toBe("subscribe");
    expect(subMsg.collection).toBe("posts");
  });

  test("setToken updates token used by realtime connection", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080" });
    client.setToken("new-token");
    client.realtime.connect();
    const ws = MockWebSocket._last()!;
    expect(ws.url).toContain("token=new-token");
  });
});
