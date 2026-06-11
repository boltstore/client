import { describe, it, expect } from "bun:test";
import { BoltstoreClient } from "../src/client";
import { getFileUrl, getSignedUrl, deleteFile, uploadFile, downloadFile } from "../src/storage";

describe("Storage Module", () => {
  function createMockClient(): BoltstoreClient {
    return new BoltstoreClient({ url: "http://localhost:8090" });
  }

  describe("getFileUrl", () => {
    it("should return a file download URL", () => {
      const client = createMockClient();
      const url = getFileUrl(client, "applications/app_1/photo.jpg");
      expect(url).toBe("http://localhost:8090/api/files/applications%2Fapp_1%2Fphoto.jpg");
    });
  });

  describe("getSignedUrl", () => {
    it("should request a signed URL", async () => {
      const client = createMockClient();
      let capturedPath = "";
      (client as any).request = async (path: string) => {
        capturedPath = path;
        return { success: true, data: { url: "https://s3.example.com/signed?token=abc" } };
      };

      const url = await getSignedUrl(client, "photo.jpg", { expiry: 3600 });
      expect(capturedPath).toContain("/api/files/photo.jpg/signed-url");
      expect(capturedPath).toContain("expiry=3600");
      expect(url).toContain("signed");
    });
  });

  describe("deleteFile", () => {
    it("should delete a file", async () => {
      const client = createMockClient();
      let capturedPath = "";
      let capturedMethod = "";
      (client as any).request = async (path: string, options: any) => {
        capturedPath = path;
        capturedMethod = options.method;
        return { success: true };
      };

      await deleteFile(client, "photo.jpg");
      expect(capturedPath).toBe("/api/files/photo.jpg");
      expect(capturedMethod).toBe("DELETE");
    });
  });
});
