import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { connectRealtime, RealtimeClient } from "../src/realtime";

describe("Realtime Module", () => {
  describe("RealtimeClient", () => {
    it("should create a RealtimeClient instance", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const rt = new RealtimeClient(client);
      expect(rt).toBeDefined();
      expect(rt.connected).toBe(false);
    });

    it("should track subscriptions", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const rt = new RealtimeClient(client);

      // Can't actually connect in tests, but we can test subscribe/unsubscribe logic
      // by mocking the ws state
      const unsub = rt.subscribe("table:proj:todos", () => {});
      expect(typeof unsub).toBe("function");

      // Unsubscribe should not throw
      expect(() => unsub()).not.toThrow();
    });

    it("should register connect and disconnect callbacks", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const rt = new RealtimeClient(client);

      let connected = false;
      let disconnected = false;

      const removeConnect = rt.onConnect(() => { connected = true; });
      const removeDisconnect = rt.onDisconnect(() => { disconnected = true; });

      expect(typeof removeConnect).toBe("function");
      expect(typeof removeDisconnect).toBe("function");

      removeConnect();
      removeDisconnect();
    });

    it("should disconnect cleanly", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const rt = new RealtimeClient(client);
      expect(() => rt.disconnect()).not.toThrow();
    });
  });

  describe("connectRealtime", () => {
    it("should create and return a RealtimeClient", () => {
      const client = new BoltstoreClient({ url: "http://localhost:8090" });
      const rt = connectRealtime(client);
      expect(rt).toBeInstanceOf(RealtimeClient);
      rt.disconnect();
    });
  });
});
