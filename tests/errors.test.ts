import { describe, expect, test } from "bun:test";
import { BoltstoreError } from "../src/errors";

describe("BoltstoreError", () => {
  test("creates error with status, code, message", () => {
    const err = new BoltstoreError(404, "NOT_FOUND", "User not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("User not found");
    expect(err.name).toBe("BoltstoreError");
  });

  test("creates error with details", () => {
    const err = new BoltstoreError(400, "VALIDATION", "Invalid input", { field: "email" });
    expect(err.details).toEqual({ field: "email" });
  });
});
