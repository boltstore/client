import { describe, expect, test } from "bun:test";
import { decodeJwtPayload } from "../src/jwt";

describe("decodeJwtPayload", () => {
  test("decodes a valid JWT payload", () => {
    const token = "header." + btoa(JSON.stringify({ sub: "usr_123", exp: 9999999999, role: "user" })) + ".sig";
    const payload = decodeJwtPayload(token);
    expect(payload?.sub).toBe("usr_123");
    expect(payload?.exp).toBe(9999999999);
    expect(payload?.role).toBe("user");
  });

  test("returns null for malformed token", () => {
    expect(decodeJwtPayload("invalid")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(decodeJwtPayload("")).toBeNull();
  });
});
