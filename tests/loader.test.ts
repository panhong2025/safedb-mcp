import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { loadConfig } from "../src/config/loader.js";
import configs from "./fixtures/configs.json";

// Mock fs and logger
vi.mock("node:fs");
vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Config Loader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadConfig — from config file", () => {
    it("loads a valid single-connection config", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_single)
      );

      const config = loadConfig();

      expect(config.connections.default).toBeDefined();
      expect(config.connections.default.url).toBe(
        "postgresql://user:pass@localhost:5432/testdb"
      );
      expect(config.connections.default.mode).toBe("readonly");
      expect(config.default_connection).toBe("default");
    });

    it("loads a valid multi-connection config with custom defaults", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_multi)
      );

      const config = loadConfig();

      expect(Object.keys(config.connections)).toHaveLength(2);
      expect(config.default_connection).toBe("dev");
      expect(config.defaults.page_size).toBe(100);
      expect(config.defaults.query_timeout).toBe(15000);
    });

    it("loads config with pro settings", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_with_pro)
      );

      const config = loadConfig();

      expect(config.pro.audit_log).toBe(true);
      expect(config.pro.license_key).toBe("some-key");
    });

    it("sets default_connection to first key when not specified", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_single)
      );

      const config = loadConfig();
      expect(config.default_connection).toBe("default");
    });
  });

  describe("loadConfig — environment variable resolution", () => {
    it("resolves ${VAR} syntax in connection URLs", () => {
      process.env.TEST_DATABASE_URL =
        "postgresql://test:test@localhost:5432/testdb";

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_with_env_vars)
      );

      const config = loadConfig();

      expect(config.connections.default.url).toBe(
        "postgresql://test:test@localhost:5432/testdb"
      );
    });

    it("throws when referenced env var is not set", () => {
      delete process.env.TEST_DATABASE_URL;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.valid_with_env_vars)
      );

      expect(() => loadConfig()).toThrow("Environment variable");
    });
  });

  describe("loadConfig — DATABASE_URL fallback", () => {
    it("uses DATABASE_URL when no config file exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.DATABASE_URL =
        "postgresql://user:pass@localhost:5432/mydb";

      const config = loadConfig();

      expect(config.connections.default).toBeDefined();
      expect(config.connections.default.url).toBe(
        "postgresql://user:pass@localhost:5432/mydb"
      );
      expect(config.connections.default.mode).toBe("readonly");
    });

    it("uses SAFEDB_MODE env var for mode when using DATABASE_URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.DATABASE_URL =
        "postgresql://user:pass@localhost:5432/mydb";
      process.env.SAFEDB_MODE = "restricted";

      const config = loadConfig();

      expect(config.connections.default.mode).toBe("restricted");
    });

    it("throws when no config file and no DATABASE_URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      delete process.env.DATABASE_URL;

      expect(() => loadConfig()).toThrow("DATABASE_URL");
    });
  });

  describe("loadConfig — Zod validation errors", () => {
    it("throws on empty connections object", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.invalid_no_connections)
      );

      expect(() => loadConfig()).toThrow("Invalid configuration");
    });

    it("throws on missing connection URL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.invalid_missing_url)
      );

      expect(() => loadConfig()).toThrow("Invalid configuration");
    });

    it("throws on invalid security mode", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.invalid_bad_mode)
      );

      expect(() => loadConfig()).toThrow("Invalid configuration");
    });

    it("throws on page_size below minimum", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(configs.invalid_page_size_too_small)
      );

      expect(() => loadConfig()).toThrow("Invalid configuration");
    });

    it("throws on invalid JSON content", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not json {{{");

      expect(() => loadConfig()).toThrow();
    });
  });
});
