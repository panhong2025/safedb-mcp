import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnManager } from "../src/core/conn-manager.js";
import { ConnectionError } from "../src/utils/errors.js";
import type { SafeDBConfig } from "../src/config/schema.js";
import pg from "pg";

// Mock pg module
vi.mock("pg", () => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return {
    default: {
      Pool: vi.fn(() => ({ ...mockPool })),
    },
  };
});

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const MockPool = vi.mocked(pg.Pool);

function createConfig(overrides?: Partial<SafeDBConfig>): SafeDBConfig {
  return {
    connections: {
      dev: {
        type: "postgresql" as const,
        url: "postgresql://dev:dev@localhost:5432/devdb",
        mode: "unrestricted" as const,
        timeout: 30000,
        max_rows: 10000,
      },
      prod: {
        type: "postgresql" as const,
        url: "postgresql://prod:prod@localhost:5432/proddb",
        mode: "readonly" as const,
        ssl: true,
        timeout: 15000,
        max_rows: 5000,
      },
    },
    default_connection: "dev",
    defaults: {
      page_size: 50,
      query_timeout: 30000,
      max_rows: 10000,
      truncate_at: 500,
    },
    pro: {
      pii_masking: false,
      audit_log: false,
      audit_log_path: "./safedb-audit.db",
    },
    ...overrides,
  };
}

describe("ConnManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getActive — lazy pool creation", () => {
    it("returns active connection with the default connection name", () => {
      const manager = new ConnManager(createConfig());
      const active = manager.getActive();

      expect(active.name).toBe("dev");
      expect(active.mode).toBe("unrestricted");
      expect(active.pool).toBeDefined();
    });

    it("creates pool lazily on first getActive call", () => {
      const manager = new ConnManager(createConfig());

      const callsBefore = MockPool.mock.calls.length;
      manager.getActive();
      const callsAfter = MockPool.mock.calls.length;

      expect(callsAfter).toBe(callsBefore + 1);
    });

    it("reuses pool on subsequent getActive calls", () => {
      const manager = new ConnManager(createConfig());

      manager.getActive();
      const callsAfterFirst = MockPool.mock.calls.length;
      manager.getActive();
      const callsAfterSecond = MockPool.mock.calls.length;

      expect(callsAfterSecond).toBe(callsAfterFirst);
    });

    it("uses first connection key when default_connection is not set", () => {
      const config = createConfig();
      delete (config as Record<string, unknown>).default_connection;
      const manager = new ConnManager(config);
      const active = manager.getActive();

      expect(active.name).toBe("dev");
    });
  });

  describe("switchTo", () => {
    it("switches to an existing connection", () => {
      const manager = new ConnManager(createConfig());
      const active = manager.switchTo("prod");

      expect(active.name).toBe("prod");
      expect(active.mode).toBe("readonly");
    });

    it("throws ConnectionError for non-existent connection", () => {
      const manager = new ConnManager(createConfig());

      expect(() => manager.switchTo("staging")).toThrow(ConnectionError);
    });

    it("includes available connections in error message", () => {
      const manager = new ConnManager(createConfig());

      try {
        manager.switchTo("staging");
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("dev");
        expect((e as Error).message).toContain("prod");
      }
    });

    it("can switch back to previous connection", () => {
      const manager = new ConnManager(createConfig());
      manager.switchTo("prod");
      const active = manager.switchTo("dev");

      expect(active.name).toBe("dev");
    });
  });

  describe("listConnections", () => {
    it("returns all configured connections with active flag", () => {
      const manager = new ConnManager(createConfig());
      const list = manager.listConnections();

      expect(list).toHaveLength(2);
      expect(list.find((c) => c.name === "dev")?.active).toBe(true);
      expect(list.find((c) => c.name === "prod")?.active).toBe(false);
    });

    it("updates active flag after switchTo", () => {
      const manager = new ConnManager(createConfig());
      manager.switchTo("prod");
      const list = manager.listConnections();

      expect(list.find((c) => c.name === "dev")?.active).toBe(false);
      expect(list.find((c) => c.name === "prod")?.active).toBe(true);
    });

    it("includes type and mode for each connection", () => {
      const manager = new ConnManager(createConfig());
      const list = manager.listConnections();

      for (const conn of list) {
        expect(conn.type).toBe("postgresql");
        expect(["readonly", "restricted", "unrestricted"]).toContain(conn.mode);
      }
    });
  });

  describe("testConnection", () => {
    it("returns true when connection is healthy", async () => {
      const manager = new ConnManager(createConfig());
      const result = await manager.testConnection();

      expect(result).toBe(true);
    });

    it("returns false when query fails", async () => {
      MockPool.mockImplementationOnce(
        () =>
          ({
            query: vi.fn().mockRejectedValue(new Error("Connection refused")),
            end: vi.fn(),
            on: vi.fn(),
          }) as never
      );

      const manager = new ConnManager(createConfig());
      const result = await manager.testConnection();

      expect(result).toBe(false);
    });
  });

  describe("closeAll", () => {
    it("closes all created pools", async () => {
      const manager = new ConnManager(createConfig());

      // Access both connections to create pools
      manager.getActive();
      manager.switchTo("prod");

      await manager.closeAll();

      // After closeAll, getting active should create a new pool
      const active = manager.getActive();
      expect(active.name).toBe("prod");
    });

    it("handles close errors gracefully", async () => {
      MockPool.mockImplementationOnce(
        () =>
          ({
            query: vi.fn(),
            end: vi.fn().mockRejectedValue(new Error("Close error")),
            on: vi.fn(),
          }) as never
      );

      const manager = new ConnManager(createConfig());
      manager.getActive();

      // Should not throw
      await expect(manager.closeAll()).resolves.toBeUndefined();
    });
  });

  describe("pool error handling", () => {
    it("registers error handler on pool creation", () => {
      const onSpy = vi.fn();
      MockPool.mockImplementationOnce(
        () =>
          ({
            query: vi.fn(),
            end: vi.fn(),
            on: onSpy,
          }) as never
      );

      const manager = new ConnManager(createConfig());
      manager.getActive();

      expect(onSpy).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });
});
