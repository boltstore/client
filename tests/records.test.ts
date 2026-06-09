import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { listRecords, getRecord, createRecord, updateRecord, deleteRecord, getAllRecords, batch } from "../src/records";

describe("Records Module", () => {
  function createMockClient(): BoltstoreClient {
    const client = new BoltstoreClient({ url: "http://localhost:8090" });
    return client;
  }

  describe("listRecords", () => {
    it("should list records with query params", async () => {
      const client = createMockClient();
      let capturedPath = "";
      let capturedParams: Record<string, string | undefined> = {};
      (client as any).request = async (path: string, options: any) => {
        capturedPath = path;
        capturedParams = options.params ?? {};
        return {
          success: true,
          data: {
            items: [{ id: "r1", title: "Hello" }],
            page: 1,
            perPage: 50,
            totalItems: 1,
            totalPages: 1,
          },
        };
      };

      const result = await listRecords(client, "todos", { filter: "done = false", sort: "-created", page: 1, perPage: 50 });

      expect(capturedPath).toBe("/api/collections/todos/records");
      expect(capturedParams.filter).toBe("done = false");
      expect(capturedParams.sort).toBe("-created");
      expect(result.items.length).toBe(1);
      expect(result.items[0].title).toBe("Hello");
    });
  });

  describe("getRecord", () => {
    it("should get a single record", async () => {
      const client = createMockClient();
      let capturedPath = "";
      (client as any).request = async (path: string) => {
        capturedPath = path;
        return { success: true, data: { id: "r1", title: "Task" } };
      };

      const record = await getRecord(client, "todos", "r1");
      expect(capturedPath).toBe("/api/collections/todos/records/r1");
      expect(record.title).toBe("Task");
    });

    it("should throw on missing record", async () => {
      const client = createMockClient();
      (client as any).request = async () => ({
        success: false,
        error: { message: "Record not found" },
      });

      try {
        await getRecord(client, "todos", "missing");
        expect(false).toBe(true);
      } catch (err) {
        expect((err as Error).message).toContain("Record not found");
      }
    });
  });

  describe("createRecord", () => {
    it("should create a record", async () => {
      const client = createMockClient();
      let capturedBody: unknown;
      (client as any).request = async (_path: string, options: any) => {
        capturedBody = options.body;
        return { success: true, data: { id: "new-id", title: "New" } };
      };

      const record = await createRecord(client, "todos", { title: "New" });
      expect((capturedBody as any).title).toBe("New");
      expect(record.id).toBe("new-id");
    });
  });

  describe("updateRecord", () => {
    it("should update a record", async () => {
      const client = createMockClient();
      let capturedPath = "";
      let capturedBody: unknown;
      (client as any).request = async (path: string, options: any) => {
        capturedPath = path;
        capturedBody = options.body;
        return { success: true, data: { id: "r1", title: "Updated" } };
      };

      const record = await updateRecord(client, "todos", "r1", { title: "Updated" });
      expect(capturedPath).toBe("/api/collections/todos/records/r1");
      expect((capturedBody as any).title).toBe("Updated");
      expect(record.title).toBe("Updated");
    });
  });

  describe("deleteRecord", () => {
    it("should delete a record", async () => {
      const client = createMockClient();
      let capturedPath = "";
      let capturedMethod = "";
      (client as any).request = async (path: string, options: any) => {
        capturedPath = path;
        capturedMethod = options.method;
        return { success: true };
      };

      await deleteRecord(client, "todos", "r1");
      expect(capturedPath).toBe("/api/collections/todos/records/r1");
      expect(capturedMethod).toBe("DELETE");
    });
  });

  describe("batch", () => {
    it("should execute multiple operations", async () => {
      const client = createMockClient();
      let capturedBody: unknown;
      (client as any).request = async (_path: string, options: any) => {
        capturedBody = options.body;
        return {
          success: true,
          data: {
            results: [
              { operation: { method: "POST", collection: "todos", data: { title: "A" } }, status: 201 },
              { operation: { method: "DELETE", collection: "todos", id: "old" }, status: 204 },
            ],
          },
        };
      };

      const results = await batch(client, [
        { method: "POST", collection: "todos", data: { title: "A" } },
        { method: "DELETE", collection: "todos", id: "old" },
      ]);

      expect((capturedBody as any).operations.length).toBe(2);
      expect(results.length).toBe(2);
      expect(results[0].status).toBe(201);
      expect(results[1].status).toBe(204);
    });

    it("should support transactional batch", async () => {
      const client = createMockClient();
      let capturedBody: unknown;
      (client as any).request = async (_path: string, options: any) => {
        capturedBody = options.body;
        return {
          success: true,
          data: { results: [{ operation: { method: "POST", collection: "todos", data: {} }, status: 201 }] },
        };
      };

      await batch(client, [{ method: "POST", collection: "todos", data: {} }], { transactional: true });
      expect((capturedBody as any).transactional).toBe(true);
    });
  });
});
