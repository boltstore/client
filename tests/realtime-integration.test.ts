import { describe, expect, test } from "bun:test";
import { BoltstoreClient } from "../src/client";

describe("BoltstoreClient — localStore auto-detection", () => {
  test("client initializes without explicit localStore", () => {
    const client = new BoltstoreClient({ baseUrl: "http://localhost:8080", databaseId: "dbs_app" });
    expect(client.localStore).toBeDefined();
  });
});
