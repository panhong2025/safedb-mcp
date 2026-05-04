import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryEngine } from "../src/core/query-engine.js";
import { Pager } from "../src/core/pager.js";
import { QueryBlockedError, SafeDBError } from "../src/utils/errors.js";
import type { ConnManager, ActiveConnection } from "../src/core/conn-manager.js";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockClient(queryResults?: Record<string, unknown>) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql === "SELECT set_config('statement_timeout', $1, true)") {
        return Promise.resolve({ rows: [] });
      }
      if (sql === "BEGIN TRANSACTION READ ONLY") {
        return Promise.resolve({ rows: [] });
      }
      if (sql === "COMMIT") {
        return Promise.resolve({ rows: [] });
      }
      // Default: return mock SELECT result
      return Promise.resolve(
        queryResults ?? {
          fields: [{ name: "id" }, { name: "name" }],
          rows: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ],
          rowCount: 2,
        }
      );
    }),
    release: vi.fn(),
  };
}

function createMockConnManager(
  mode: "readonly" | "restricted" | "unrestricted" = "readonly",
  client = createMockClient()
): ConnManager {
  const mockPool = {
    connect: vi.fn().mockResolvedValue(client),
  };

  const active: ActiveConnection = {
    name: "test",
    pool: mockPool as never,
    config: {
      type: "postgresql" as const,
      url: "postgresql://test@localhost/testdb",
      mode,
      timeout: 30000,
      max_rows: 10000,
    },
    mode,
  };

  return {
    getActive: vi.fn().mockReturnValue(active),
  } as unknown as ConnManager;
}

describe("QueryEngine", () => {
  let pager: Pager;

  beforeEach(() => {
    vi.clearAllMocks();
    pager = new Pager(50, 500);
  });

  describe("execute — full pipeline (validate → execute → paginate)", () => {
    it("executes a valid SELECT query and returns paged result", async () => {
      const connManager = createMockConnManager("readonly");
      const engine = new QueryEngine(connManager, pager);

      const result = await engine.execute({ sql: "SELECT * FROM users" });

      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toHaveLength(2);
      expect(result.total_rows).toBe(2);
      expect(result.page).toBe(1);
      expect(result.has_more).toBe(false);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("rejects blocked SQL before executing", async () => {
      const client = createMockClient();
      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      await expect(
        engine.execute({ sql: "DROP TABLE users" })
      ).rejects.toThrow(QueryBlockedError);

      // Should not have connected to database
      expect(client.query).not.toHaveBeenCalled();
    });

    it("rejects multi-statement SQL", async () => {
      const connManager = createMockConnManager("readonly");
      const engine = new QueryEngine(connManager, pager);

      await expect(
        engine.execute({ sql: "SELECT 1; DELETE FROM users" })
      ).rejects.toThrow(QueryBlockedError);
    });
  });

  describe("readonly transaction wrapping", () => {
    it("wraps readonly queries in READ ONLY transaction", async () => {
      const client = createMockClient();
      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      await engine.execute({ sql: "SELECT * FROM users" });

      const calls = client.query.mock.calls.map((c) => c[0]);
      expect(calls).toContain("BEGIN TRANSACTION READ ONLY");
      expect(calls).toContain("COMMIT");
    });

    it("sets statement_timeout via set_config", async () => {
      const client = createMockClient();
      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      await engine.execute({ sql: "SELECT 1" });

      expect(client.query).toHaveBeenCalledWith(
        "SELECT set_config('statement_timeout', $1, true)",
        ["30000"]
      );
    });

    it("does not wrap non-readonly queries in transaction", async () => {
      const client = createMockClient({
        fields: [{ name: "result" }],
        rows: [{ result: "ok" }],
        rowCount: 1,
      });
      const connManager = createMockConnManager("restricted", client);
      const engine = new QueryEngine(connManager, pager);

      await engine.execute({
        sql: "INSERT INTO users (name) VALUES ('test')",
      });

      const calls = client.query.mock.calls.map((c) => c[0]);
      expect(calls).not.toContain("BEGIN TRANSACTION READ ONLY");
    });
  });

  describe("write operations", () => {
    it("returns result with warnings for write operations", async () => {
      const client = createMockClient();
      // Override to return write-style result (no fields)
      client.query.mockImplementation((sql: string) => {
        if (sql.startsWith("SELECT set_config")) {
          return Promise.resolve({ rows: [] });
        }
        // INSERT result — no fields
        return Promise.resolve({
          fields: undefined,
          rows: undefined,
          rowCount: 1,
        });
      });

      const connManager = createMockConnManager("restricted", client);
      const engine = new QueryEngine(connManager, pager);

      const result = await engine.execute({
        sql: "INSERT INTO users (name) VALUES ('test')",
      });

      expect(result.rows[0]![0]).toContain("INSERT");
      expect(result.rows[0]![0]).toContain("1 row(s) affected");
    });
  });

  describe("error handling", () => {
    it("wraps database errors in SafeDBError", async () => {
      const client = createMockClient();
      client.query.mockImplementation((sql: string) => {
        if (sql.startsWith("SELECT set_config")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql === "BEGIN TRANSACTION READ ONLY") {
          return Promise.resolve({ rows: [] });
        }
        return Promise.reject(new Error("relation \"users\" does not exist"));
      });

      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      await expect(
        engine.execute({ sql: "SELECT * FROM users" })
      ).rejects.toThrow(SafeDBError);
    });

    it("releases client even on error", async () => {
      const client = createMockClient();
      client.query.mockImplementation((sql: string) => {
        if (sql.startsWith("SELECT set_config")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql === "BEGIN TRANSACTION READ ONLY") {
          return Promise.resolve({ rows: [] });
        }
        return Promise.reject(new Error("query failed"));
      });

      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      try {
        await engine.execute({ sql: "SELECT * FROM users" });
      } catch {
        // expected
      }

      expect(client.release).toHaveBeenCalled();
    });

    it("preserves SafeDBError subclasses without re-wrapping", async () => {
      const client = createMockClient();
      // Guard will throw QueryBlockedError for empty query
      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, pager);

      await expect(engine.execute({ sql: "" })).rejects.toThrow(
        QueryBlockedError
      );
    });
  });

  describe("nextPage", () => {
    it("delegates to pager.nextPage", () => {
      const connManager = createMockConnManager();
      const engine = new QueryEngine(connManager, pager);

      // No previous query
      expect(engine.nextPage()).toBeNull();
    });

    it("returns next page after execute", async () => {
      // Create a pager with small page size
      const smallPager = new Pager(1, 500);
      const client = createMockClient({
        fields: [{ name: "id" }],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        rowCount: 3,
      });
      const connManager = createMockConnManager("readonly", client);
      const engine = new QueryEngine(connManager, smallPager);

      const page1 = await engine.execute({ sql: "SELECT id FROM users" });
      expect(page1.page).toBe(1);
      expect(page1.has_more).toBe(true);

      const page2 = engine.nextPage();
      expect(page2).not.toBeNull();
      expect(page2!.page).toBe(2);
    });
  });
});
