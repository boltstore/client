import { describe, expect, test, beforeEach } from "bun:test";
import { SubscriptionManager, type SubscribeOptions } from "../../src/ws/subscription";
import type { ConnectionState } from "@boltstore/utils";

function createManager(): {
  manager: SubscriptionManager;
  sent: Record<string, unknown>[];
  messages: ((data: unknown) => void)[];
  stateHandlers: ((state: ConnectionState) => void)[];
  /** Simulate a server ack for the most recent subscribe message. */
  ackLastSubscribe: () => void;
} {
  const sent: Record<string, unknown>[] = [];
  const messages: ((data: unknown) => void)[] = [];
  const stateHandlers: ((state: ConnectionState) => void)[] = [];
  let ackCounter = 0;

  const manager = new SubscriptionManager(
    (msg) => sent.push(msg),
    (handler) => messages.push(handler),
    (handler) => stateHandlers.push(handler),
  );

  function ackLastSubscribe(): void {
    ackCounter++;
    const last = sent.filter((m) => m.type === "subscribe").pop();
    const localId = last?.localId as string | undefined;
    if (localId && messages[0]) {
      messages[0]({ type: "subscribed", subscriptionId: `sub_server_${ackCounter}`, localId });
    }
  }

  return { manager, sent, messages, stateHandlers, ackLastSubscribe };
}

function simulateConnected(stateHandlers: ((state: ConnectionState) => void)[]): void {
  for (const h of stateHandlers) h("connected");
}

describe("SubscriptionManager", () => {
  let ctx: ReturnType<typeof createManager>;

  beforeEach(() => {
    ctx = createManager();
  });

  test("subscribe sends subscribe message and returns local ID", () => {
    const subId = ctx.manager.subscribe("posts", {
      onEvent: () => {},
    });
    expect(subId).toBeDefined();
    expect(typeof subId).toBe("string");
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].type).toBe("subscribe");
    expect(ctx.sent[0].collection).toBe("posts");
  });

  test("subscribe with recordId and filter sends them in the message", () => {
    ctx.manager.subscribe("posts", {
      recordId: "rec_123",
      filter: { status: "published" },
      onEvent: () => {},
    });
    expect(ctx.sent[0].recordId).toBe("rec_123");
    expect((ctx.sent[0].filter as Record<string, unknown>).status).toBe("published");
  });

  test("subscribed response moves pending to active", () => {
    const subId = ctx.manager.subscribe("posts", { onEvent: () => {} });
    const active = ctx.manager.getActiveSubscriptions();
    expect(active).toHaveLength(1);
    expect(active[0].subscriptionId).toBe(subId);
    expect(active[0].collection).toBe("posts");

    // Simulate server ack
    ctx.ackLastSubscribe();

    const updated = ctx.manager.getActiveSubscriptions();
    expect(updated).toHaveLength(1);
    expect(updated[0].subscriptionId).toBe("sub_server_1");
  });

  test("unsubscribe sends unsubscribe message and removes subscription", () => {
    const subId = ctx.manager.subscribe("posts", { onEvent: () => {} });
    ctx.ackLastSubscribe();

    ctx.manager.unsubscribe("sub_server_1");

    expect(ctx.sent[1].type).toBe("unsubscribe");
    expect(ctx.sent[1].subscriptionId).toBe("sub_server_1");
    expect(ctx.manager.getActiveSubscriptions()).toHaveLength(0);
  });

  test("unsubscribe with local ID removes pending subscription", () => {
    const subId = ctx.manager.subscribe("posts", { onEvent: () => {} });
    ctx.manager.unsubscribe(subId);
    expect(ctx.manager.getActiveSubscriptions()).toHaveLength(0);
  });

  test("unsubscribeAll clears all subscriptions", () => {
    ctx.manager.subscribe("posts", { onEvent: () => {} });
    ctx.ackLastSubscribe();
    ctx.manager.subscribe("comments", { onEvent: () => {} });
    ctx.ackLastSubscribe();

    ctx.manager.unsubscribeAll();

    expect(ctx.manager.getActiveSubscriptions()).toHaveLength(0);
    const unsubMessages = ctx.sent.filter((m) => m.type === "unsubscribe");
    expect(unsubMessages).toHaveLength(2);
  });

  test("incoming event dispatches to matching subscription callback", () => {
    const events: unknown[] = [];
    ctx.manager.subscribe("posts", { onEvent: (e) => events.push(e) });
    ctx.ackLastSubscribe();

    const recordEvent = {
      type: "event",
      event: "create",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_1", title: "Hello" },
    };
    ctx.messages[0](recordEvent);

    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).event).toBe("create");
  });

  test("event does not dispatch to non-matching collection", () => {
    const events: unknown[] = [];
    ctx.manager.subscribe("posts", { onEvent: (e) => events.push(e) });
    ctx.ackLastSubscribe();

    ctx.messages[0]({
      type: "event",
      event: "update",
      collection: "comments",
      databaseId: "dbs_abc",
      record: { id: "rec_2" },
    });

    expect(events).toHaveLength(0);
  });

  test("event dispatches only to matching recordId", () => {
    const events: unknown[] = [];
    ctx.manager.subscribe("posts", {
      recordId: "rec_1",
      onEvent: (e) => events.push(e),
    });
    ctx.ackLastSubscribe();

    ctx.messages[0]({
      type: "event",
      event: "update",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_2" },
    });

    expect(events).toHaveLength(0);
  });

  test("event dispatches to matching recordId", () => {
    const events: unknown[] = [];
    ctx.manager.subscribe("posts", {
      recordId: "rec_1",
      onEvent: (e) => events.push(e),
    });
    ctx.ackLastSubscribe();

    ctx.messages[0]({
      type: "event",
      event: "update",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_1", title: "Updated" },
    });

    expect(events).toHaveLength(1);
  });

  test("event respects filter matching", () => {
    const events: unknown[] = [];
    ctx.manager.subscribe("posts", {
      filter: { status: "published" },
      onEvent: (e) => events.push(e),
    });
    ctx.ackLastSubscribe();

    // Record with non-matching filter
    ctx.messages[0]({
      type: "event",
      event: "create",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_1", status: "draft" },
    });
    expect(events).toHaveLength(0);

    // Record with matching filter
    ctx.messages[0]({
      type: "event",
      event: "create",
      collection: "posts",
      databaseId: "dbs_abc",
      record: { id: "rec_2", status: "published" },
    });
    expect(events).toHaveLength(1);
  });

  test("error message calls onError on active subscriptions", () => {
    const errors: { code: string; message: string }[] = [];
    ctx.manager.subscribe("posts", {
      onEvent: () => {},
      onError: (e) => errors.push(e),
    });
    ctx.ackLastSubscribe();

    ctx.messages[0]({ type: "error", code: "NO_DATABASE", message: "No database" });

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("NO_DATABASE");
  });

  test("auto-resubscribes on reconnect", () => {
    ctx.manager.subscribe("posts", { onEvent: () => {} });
    ctx.ackLastSubscribe();
    ctx.manager.subscribe("comments", { onEvent: () => {} });
    ctx.ackLastSubscribe();

    // Clear sent messages
    ctx.sent.length = 0;

    // Simulate disconnect then reconnect
    for (const h of ctx.stateHandlers) h("disconnected");
    for (const h of ctx.stateHandlers) h("connected");

    // Should have re-sent subscribe messages
    const subscribeMessages = ctx.sent.filter((m) => m.type === "subscribe");
    expect(subscribeMessages).toHaveLength(2);
    expect(subscribeMessages[0].collection).toBe("posts");
    expect(subscribeMessages[1].collection).toBe("comments");
  });

  test("getActiveSubscriptions returns both pending and active", () => {
    ctx.manager.subscribe("posts", { onEvent: () => {} });
    ctx.ackLastSubscribe();
    ctx.manager.subscribe("comments", { onEvent: () => {} });

    const subs = ctx.manager.getActiveSubscriptions();
    expect(subs).toHaveLength(2);
    const collections = subs.map((s) => s.collection).sort();
    expect(collections).toEqual(["comments", "posts"]);
  });

  test("subscribe returns unique IDs each time", () => {
    const id1 = ctx.manager.subscribe("posts", { onEvent: () => {} });
    const id2 = ctx.manager.subscribe("comments", { onEvent: () => {} });
    expect(id1).not.toBe(id2);
  });
});
