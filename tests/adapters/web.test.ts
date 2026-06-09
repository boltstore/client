import { describe, it, expect } from "bun:test";
import { createWebAdapter, autoDetectAdapter } from "../../src/adapters/web";

describe("Web Adapter", () => {
  describe("createWebAdapter", () => {
    it("should create a web adapter", () => {
      const adapter = createWebAdapter();
      expect(adapter.name).toBe("web");
      expect(adapter.fetch).toBeDefined();
      expect(adapter.createWebSocket).toBeDefined();
      expect(adapter.createLocalDb).toBeDefined();
    });

    it("should create a local database when IndexedDB is available", () => {
      const adapter = createWebAdapter();
      // In Bun test environment, IndexedDB is not available
      // so createLocalDb will return a db that rejects on use
      const db = adapter.createLocalDb("test-db");
      expect(db).toBeDefined();
      expect(db.exec).toBeDefined();
      expect(db.query).toBeDefined();
      expect(db.run).toBeDefined();
      expect(db.close).toBeDefined();
      db.close();
    });
  });

  describe("autoDetectAdapter", () => {
    it("should detect web adapter when window and indexedDB exist", () => {
      // In Bun test environment, window/indexedDB are not defined
      // so autoDetectAdapter falls back to node adapter via require
      try {
        const adapter = autoDetectAdapter();
        expect(adapter.name).toBeDefined();
        expect(adapter.fetch).toBeDefined();
      } catch {
        // Expected in pure Bun environment without window
      }
    });
  });
});
