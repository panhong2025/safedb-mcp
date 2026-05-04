import { describe, it, expect } from "vitest";
import { validateSQL } from "../src/core/guard.js";
import { QueryBlockedError } from "../src/utils/errors.js";
import payloads from "./fixtures/injection-payloads.json";

describe("Guard - SQL Security Layer", () => {
  describe("Injection payload tests", () => {
    for (const payload of payloads) {
      it(`${payload.should_block ? "BLOCKS" : "ALLOWS"}: ${payload.name}`, () => {
        if (payload.should_block) {
          expect(() => validateSQL(payload.sql, "readonly")).toThrow(QueryBlockedError);
        } else {
          const result = validateSQL(payload.sql, "readonly");
          expect(result.safe).toBe(true);
        }
      });
    }
  });

  describe("Mode-based access control", () => {
    it("allows SELECT in readonly mode", () => {
      const result = validateSQL("SELECT * FROM users", "readonly");
      expect(result.safe).toBe(true);
      expect(result.isWrite).toBe(false);
    });

    it("blocks INSERT in readonly mode", () => {
      expect(() =>
        validateSQL("INSERT INTO users (name) VALUES ('test')", "readonly")
      ).toThrow(QueryBlockedError);
    });

    it("allows INSERT in restricted mode", () => {
      const result = validateSQL("INSERT INTO users (name) VALUES ('test')", "restricted");
      expect(result.safe).toBe(true);
      expect(result.isWrite).toBe(true);
    });

    it("blocks DROP TABLE in restricted mode", () => {
      expect(() =>
        validateSQL("DROP TABLE users", "restricted")
      ).toThrow(QueryBlockedError);
    });

    it("allows DROP TABLE in unrestricted mode", () => {
      const result = validateSQL("DROP TABLE users", "unrestricted");
      expect(result.safe).toBe(true);
    });

    it("blocks dangerous functions even in unrestricted mode", () => {
      expect(() =>
        validateSQL("SELECT pg_read_file('/etc/passwd')", "unrestricted")
      ).toThrow(QueryBlockedError);
    });
  });

  describe("Edge cases", () => {
    it("blocks empty queries", () => {
      expect(() => validateSQL("", "readonly")).toThrow(QueryBlockedError);
      expect(() => validateSQL("   ", "readonly")).toThrow(QueryBlockedError);
    });

    it("allows trailing semicolon", () => {
      const result = validateSQL("SELECT 1;", "readonly");
      expect(result.safe).toBe(true);
    });

    it("handles SQL with comments correctly", () => {
      const result = validateSQL("SELECT * FROM users -- this is a comment", "readonly");
      expect(result.safe).toBe(true);
    });
  });
});
