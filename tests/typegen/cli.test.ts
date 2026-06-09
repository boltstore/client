import { describe, it, expect } from "bun:test";
import { toPascalCase } from "../../src/typegen/cli";

describe("TypeGen CLI", () => {
  describe("toPascalCase", () => {
    it("should convert snake_case to PascalCase", () => {
      expect(toPascalCase("user_profiles")).toBe("UserProfiles");
    });

    it("should convert kebab-case to PascalCase", () => {
      expect(toPascalCase("user-profiles")).toBe("UserProfiles");
    });

    it("should handle simple names", () => {
      expect(toPascalCase("todos")).toBe("Todos");
    });

    it("should keep existing PascalCase", () => {
      expect(toPascalCase("UserProfiles")).toBe("UserProfiles");
    });
  });
});
