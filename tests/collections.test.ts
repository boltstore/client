import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { listCollections, getCollectionSchema, createCollection, updateCollection, deleteCollection } from "../src/collections";

describe("Collections Module", () => {
  function createMockClient(): BoltstoreClient {
    return new BoltstoreClient({ url: "http://localhost:8090" });
  }

  describe("listCollections", () => {
    it("should list all collections", async () => {
      const client = createMockClient();
      let capturedPath = "";
      (client as any).request = async (path: string) => {
        capturedPath = path;
        return {
          success: true,
          data: [
            { id: "c1", name: "todos", fields: [], system: false, created: "2024-01-01", updated: "2024-01-01" },
            { id: "c2", name: "users", fields: [], system: false, created: "2024-01-01", updated: "2024-01-01" },
          ],
        };
      };

      const collections = await listCollections(client);
      expect(capturedPath).toBe("/api/collections");
      expect(collections.length).toBe(2);
      expect(collections[0].name).toBe("todos");
    });

    it("should throw on failure", async () => {
      const client = createMockClient();
      (client as any).request = async () => ({
        success: false,
        error: { message: "Unauthorized" },
      });

      try {
        await listCollections(client);
        expect(false).toBe(true);
      } catch (err) {
        expect((err as Error).message).toContain("Unauthorized");
      }
    });
  });

  describe("getCollectionSchema", () => {
    it("should get a collection schema", async () => {
      const client = createMockClient();
      let capturedPath = "";
      (client as any).request = async (path: string) => {
        capturedPath = path;
        return {
          success: true,
          data: { id: "c1", name: "todos", fields: [{ name: "title", type: "text", required: true }], system: false, created: "2024-01-01", updated: "2024-01-01" },
        };
      };

      const schema = await getCollectionSchema(client, "todos");
      expect(capturedPath).toBe("/api/collections/todos");
      expect(schema.name).toBe("todos");
      expect(schema.fields[0].name).toBe("title");
    });
  });

  describe("createCollection", () => {
    it("should create a collection", async () => {
      const client = createMockClient();
      let capturedBody: unknown;
      (client as any).request = async (_path: string, options: any) => {
        capturedBody = options.body;
        return { success: true, data: { id: "c-new", name: "notes", fields: [], system: false, created: "2024-01-01", updated: "2024-01-01" } };
      };

      const schema = await createCollection(client, { name: "notes", fields: [{ name: "body", type: "text", required: false }] });
      expect((capturedBody as any).name).toBe("notes");
      expect(schema.name).toBe("notes");
    });
  });

  describe("updateCollection", () => {
    it("should update a collection", async () => {
      const client = createMockClient();
      let capturedPath = "";
      (client as any).request = async (path: string, _options: any) => {
        capturedPath = path;
        return { success: true, data: { id: "c1", name: "todos", fields: [{ name: "done", type: "bool", required: false }], system: false, created: "2024-01-01", updated: "2024-01-01" } };
      };

      const schema = await updateCollection(client, "todos", { fields: [{ name: "done", type: "bool", required: false }] });
      expect(capturedPath).toBe("/api/collections/todos");
      expect(schema.fields[0].name).toBe("done");
    });
  });

  describe("deleteCollection", () => {
    it("should delete a collection", async () => {
      const client = createMockClient();
      let capturedPath = "";
      let capturedMethod = "";
      (client as any).request = async (path: string, options: any) => {
        capturedPath = path;
        capturedMethod = options.method;
        return { success: true };
      };

      await deleteCollection(client, "todos");
      expect(capturedPath).toBe("/api/collections/todos");
      expect(capturedMethod).toBe("DELETE");
    });
  });
});
