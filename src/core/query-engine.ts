import type { ConnManager } from "./conn-manager.js";
import type { Pager, PagedResult } from "./pager.js";
import { validateSQL } from "./guard.js";
import { sanitizeError, SafeDBError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface QueryOptions {
  sql: string;
  params?: unknown[];
  pageSize?: number;
}

/**
 * Unified query execution engine.
 * Orchestrates: Guard → ConnManager → Execute → Pager
 */
export class QueryEngine {
  constructor(
    private connManager: ConnManager,
    private pager: Pager
  ) {}

  /**
   * Execute a SQL query with full security pipeline.
   */
  async execute(options: QueryOptions): Promise<PagedResult> {
    const { sql, params = [] } = options;
    const conn = this.connManager.getActive();
    const startTime = Date.now();

    // Step 1: Security validation
    const guard = validateSQL(sql, conn.mode);

    if (guard.isWrite) {
      logger.info("Write operation detected", {
        type: guard.statementType,
        mode: conn.mode,
        connection: conn.name,
      });
    }

    // Step 2: Execute query with safety wrappers
    try {
      const client = await conn.pool.connect();
      try {
        // Set statement timeout using set_config (parameterized, injection-safe)
        const timeout = conn.config.timeout;
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeout)]);

        // Wrap readonly queries in read-only transaction
        if (conn.mode === "readonly") {
          logger.debug("Transaction started", { mode: "readonly", connection: conn.name });
          await client.query("BEGIN TRANSACTION READ ONLY");
        }

        const result = await client.query(sql, params);
        const executionTime = Date.now() - startTime;

        if (conn.mode === "readonly") {
          await client.query("COMMIT");
          logger.debug("Transaction committed", { connection: conn.name, time_ms: executionTime });
        }

        // Step 3: Format and page results
        if (result.fields && result.rows) {
          const columns = result.fields.map((f) => f.name);
          const rows = result.rows.map((row: Record<string, unknown>) =>
            columns.map((col) => row[col])
          );

          logger.debug("Query executed", {
            type: guard.statementType,
            rows: rows.length,
            time_ms: executionTime,
          });

          return this.pager.formatResult(columns, rows, executionTime);
        }

        // For non-SELECT queries (INSERT/UPDATE/DELETE), return affected rows
        return {
          columns: ["result"],
          rows: [[`${guard.statementType.toUpperCase()} completed. ${result.rowCount ?? 0} row(s) affected.`]],
          total_rows: 1,
          page: 1,
          total_pages: 1,
          has_more: false,
          execution_time_ms: Date.now() - startTime,
          ...(guard.isWrite
            ? { warnings: ["⚠️ WRITE OPERATION executed on connection: " + conn.name] }
            : {}),
        } as PagedResult & { warnings?: string[] };
      } finally {
        client.release();
      }
    } catch (e) {
      if (e instanceof SafeDBError) throw e;

      // Rollback if we started a transaction
      // (pool will handle the actual rollback on release)

      const message = sanitizeError(e);
      logger.error("Query execution failed", { error: message });
      throw new SafeDBError(
        `Query failed: ${message}`,
        "QUERY_ERROR",
        "Check your SQL syntax and database connectivity."
      );
    }
  }

  /** Get next page of previous query results. */
  nextPage(): PagedResult | null {
    return this.pager.nextPage();
  }
}
