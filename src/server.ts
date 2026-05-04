import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config/loader.js";
import { ConnManager } from "./core/conn-manager.js";
import { QueryEngine } from "./core/query-engine.js";
import { SchemaReader } from "./core/schema-reader.js";
import { Pager } from "./core/pager.js";
import { LicenseManager } from "./auth/license.js";
import { QueryAuditLog } from "./tools/query-log.js";
import { validateSQL } from "./core/guard.js";
import { SafeDBError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import type { PagedResult } from "./core/pager.js";

function formatError(e: unknown): { content: Array<{ type: "text"; text: string }> } {
  if (e instanceof SafeDBError) {
    const text = [
      `❌ ${e.code}: ${e.message}`,
      e.suggestion ? `\n💡 ${e.suggestion}` : "",
    ].filter(Boolean).join("");
    return { content: [{ type: "text", text }] };
  }
  logger.error("Unexpected error", { error: e instanceof Error ? e.message : String(e) });
  return { content: [{ type: "text", text: "❌ An unexpected error occurred. Check SafeDB logs." }] };
}

function formatPagedResult(result: PagedResult & { warnings?: string[] }): string {
  const lines: string[] = [];
  if (result.warnings) { for (const w of result.warnings) lines.push(w); lines.push(""); }
  if (result.columns.length > 0 && result.rows.length > 0) {
    lines.push(result.columns.join(" | "));
    lines.push(result.columns.map(c => "-".repeat(Math.max(c.length, 3))).join("-+-"));
    for (const row of result.rows) {
      lines.push(row.map(v => v === null ? "NULL" : String(v)).join(" | "));
    }
  }
  lines.push("");
  lines.push(`Rows: ${result.total_rows} | Page: ${result.page}/${result.total_pages} | Time: ${result.execution_time_ms}ms`);
  if (result.has_more) lines.push("→ More results available. Call next_page to see more.");
  if (result.truncated_fields?.length) lines.push(`⚠️ Truncated fields: ${result.truncated_fields.join(", ")}`);
  return lines.join("\n");
}

export function createServer() {
  const config = loadConfig();
  logger.info("Config loaded", { connections: Object.keys(config.connections).length });

  const connManager = new ConnManager(config);
  const pager = new Pager(config.defaults.page_size, config.defaults.truncate_at);
  const queryEngine = new QueryEngine(connManager, pager);
  const activeConn = connManager.getActive();
  const schemaReader = new SchemaReader(activeConn.pool);
  const licenseManager = new LicenseManager(config.pro.license_key);
  const auditLog = new QueryAuditLog();

  if (licenseManager.isPro()) logger.info("Pro license active", licenseManager.getInfo());

  const server = new McpServer({ name: "safedb-mcp", version: "1.0.0" });

  // ─── Tool 1: list_connections ───
  server.tool(
    "list_connections",
    "List all configured database connections and show which one is currently active.",
    {},
    async () => {
      try {
        logger.debug("Tool called", { tool: "list_connections" });
        const conns = connManager.listConnections();
        const lines = conns.map(c =>
          `${c.active ? "→ " : "  "}${c.name} (${c.type}, mode: ${c.mode})${c.active ? " [ACTIVE]" : ""}`
        );
        return { content: [{ type: "text", text: `Database connections:\n${lines.join("\n")}` }] };
      } catch (e) { return formatError(e); }
    }
  );

  // ─── Tool 2: use_connection ───
  server.tool(
    "use_connection",
    "Switch to a different database connection by name.",
    { name: z.string().describe("Connection name from list_connections") },
    async ({ name }) => {
      try {
        logger.info("Tool called", { tool: "use_connection", connection: name });
        const conn = connManager.switchTo(name);
        schemaReader.setPool(conn.pool);
        const overview = await schemaReader.getOverview();
        const tableList = overview.tables.slice(0, 20)
          .map(t => `  ${t.name} (~${t.rows_estimate} rows)${t.comment ? ` — ${t.comment}` : ""}`)
          .join("\n");
        const more = overview.table_count > 20 ? `\n  ... and ${overview.table_count - 20} more` : "";
        return { content: [{ type: "text", text: `Switched to '${conn.name}' (mode: ${conn.mode})\n\nDatabase: ${overview.database}\nTables (${overview.table_count}):\n${tableList}${more}` }] };
      } catch (e) { return formatError(e); }
    }
  );

  // ─── Tool 3: get_schema ───
  server.tool(
    "get_schema",
    "Get database schema. Without args = table overview. With table name = full column details, indexes, foreign keys.",
    {
      table: z.string().optional().describe("Table name for full details. Omit for overview."),
      schema: z.string().optional().describe("Schema name (default: public)"),
    },
    async ({ table, schema }) => {
      try {
        logger.debug("Tool called", { tool: "get_schema", table: table ?? "overview", schema: schema ?? "public" });
        if (table) {
          const detail = await schemaReader.getTableDetail(table, schema ?? "public");
          const colLines = detail.columns.map(c => {
            const parts = [`  ${c.name}: ${c.type}`];
            if (c.is_pk) parts.push("[PK]");
            if (!c.nullable) parts.push("NOT NULL");
            if (c.default_value) parts.push(`DEFAULT ${c.default_value}`);
            if (c.comment) parts.push(`— ${c.comment}`);
            return parts.join(" ");
          });
          const idxLines = detail.indexes.map(i => `  ${i.name}: (${i.columns.join(", ")})${i.unique ? " UNIQUE" : ""}`);
          const fkLines = detail.foreign_keys.map(f => `  ${f.column} → ${f.references}`);
          let text = `Table: ${detail.schema}.${detail.table}`;
          if (detail.comment) text += `\nComment: ${detail.comment}`;
          text += `\nRows (estimate): ${detail.row_estimate}\n\nColumns:\n${colLines.join("\n")}`;
          if (idxLines.length) text += `\n\nIndexes:\n${idxLines.join("\n")}`;
          if (fkLines.length) text += `\n\nForeign Keys:\n${fkLines.join("\n")}`;
          return { content: [{ type: "text", text }] };
        }
        const overview = await schemaReader.getOverview();
        const tableLines = overview.tables.map(t =>
          `  ${t.schema}.${t.name} (~${t.rows_estimate} rows)${t.comment ? ` — ${t.comment}` : ""}`
        );
        let text = `Database: ${overview.database}\nTables: ${overview.table_count}\n\n${tableLines.join("\n")}`;
        if (overview.hint) text += `\n\n💡 ${overview.hint}`;
        return { content: [{ type: "text", text }] };
      } catch (e) { return formatError(e); }
    }
  );

  // ─── Tool 4: query ───
  server.tool(
    "query",
    "Execute a SQL query. Results are paginated. In readonly mode, only SELECT is allowed. Single statements only.",
    {
      sql: z.string().describe("SQL query (single statement only)"),
      params: z.array(z.any()).optional().describe("Parameterized query values (for $1, $2, ...)"),
      page_size: z.number().optional().describe("Rows per page (default: 50, max: 500)"),
    },
    async ({ sql, params, page_size }) => {
      try {
        logger.info("Tool called", { tool: "query", sql: sql.substring(0, 100), connection: connManager.getActive().name });
        const result = await queryEngine.execute({ sql, params, pageSize: page_size });
        if (licenseManager.isPro()) {
          auditLog.record({ sql, connection: connManager.getActive().name, execution_time_ms: result.execution_time_ms, rows_returned: result.total_rows, blocked: false });
        }
        return { content: [{ type: "text", text: formatPagedResult(result as PagedResult & { warnings?: string[] }) }] };
      } catch (e) {
        if (e instanceof SafeDBError && e.code === "BLOCKED" && licenseManager.isPro()) {
          auditLog.record({ sql, connection: connManager.getActive().name, execution_time_ms: 0, rows_returned: 0, blocked: true });
        }
        return formatError(e);
      }
    }
  );

  // ─── Tool 5: next_page ───
  server.tool(
    "next_page",
    "Get the next page of results from the last query.",
    {},
    async () => {
      logger.debug("Tool called", { tool: "next_page" });
      const result = queryEngine.nextPage();
      if (!result) return { content: [{ type: "text", text: "No more pages. Run a new query first." }] };
      return { content: [{ type: "text", text: formatPagedResult(result as PagedResult & { warnings?: string[] }) }] };
    }
  );

  // ─── Tool 6: explain_query [Pro] ───
  server.tool(
    "explain_query",
    "[Pro] Analyze a SQL query's execution plan with performance suggestions.",
    { sql: z.string().describe("SELECT query to analyze") },
    async ({ sql }) => {
      try {
        logger.info("Tool called", { tool: "explain_query", sql: sql.substring(0, 100) });
        licenseManager.requireFeature("explain_query");
        const conn = connManager.getActive();

        // Security: validate the SQL through Guard before EXPLAIN
        // EXPLAIN ANALYZE actually executes the query, so it must pass security checks
        const guard = validateSQL(sql, conn.mode);
        if (guard.isWrite) {
          return { content: [{ type: "text", text: "❌ explain_query only accepts read-only queries (SELECT). Write operations would be executed by EXPLAIN ANALYZE." }] };
        }

        const client = await conn.pool.connect();
        try {
          await client.query("BEGIN TRANSACTION READ ONLY");
          const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
          await client.query("ROLLBACK");
          const plan = result.rows.map((r: Record<string, unknown>) => r["QUERY PLAN"]).join("\n");
          const suggestions: string[] = [];
          if (plan.includes("Seq Scan")) suggestions.push("⚠️ Sequential scan detected — consider adding an index.");
          if (plan.includes("Sort") && !plan.includes("Index Scan")) suggestions.push("💡 Sort without index — consider adding an index matching ORDER BY.");
          let text = `EXPLAIN ANALYZE:\n\n${plan}`;
          if (suggestions.length) text += `\n\nSuggestions:\n${suggestions.join("\n")}`;
          return { content: [{ type: "text", text }] };
        } finally { client.release(); }
      } catch (e) { return formatError(e); }
    }
  );

  // ─── Tool 7: suggest_indexes [Pro] ───
  server.tool(
    "suggest_indexes",
    "[Pro] Analyze slow queries via pg_stat_statements and suggest indexes.",
    { limit: z.number().optional().describe("Number of slowest queries to show (default: 10)") },
    async ({ limit }) => {
      try {
        logger.info("Tool called", { tool: "suggest_indexes", limit: limit ?? 10 });
        licenseManager.requireFeature("suggest_indexes");
        const conn = connManager.getActive();
        const n = limit ?? 10;
        const result = await conn.pool.query(
          `SELECT query, calls, round(total_exec_time::numeric, 2) AS total_time_ms, round(mean_exec_time::numeric, 2) AS avg_time_ms, rows FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY mean_exec_time DESC LIMIT $1`,
          [n]
        );
        if (result.rows.length === 0) return { content: [{ type: "text", text: "No stats found. Enable pg_stat_statements: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" }] };
        const lines = result.rows.map((r: Record<string, unknown>, i: number) =>
          `#${i + 1} (avg: ${r.avg_time_ms}ms, calls: ${r.calls})\n  ${(r.query as string).substring(0, 200)}`
        );
        return { content: [{ type: "text", text: `Top ${result.rows.length} slowest queries:\n\n${lines.join("\n\n")}\n\n💡 Use explain_query for detailed analysis.` }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("pg_stat_statements")) return { content: [{ type: "text", text: "pg_stat_statements not enabled. Run: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" }] };
        return formatError(e);
      }
    }
  );

  // ─── Tool 8: query_log [Pro] ───
  server.tool(
    "query_log",
    "[Pro] View recent query history with execution times.",
    { limit: z.number().optional().describe("Number of recent queries (default: 20)") },
    async ({ limit }) => {
      try {
        logger.debug("Tool called", { tool: "query_log", limit: limit ?? 20 });
        licenseManager.requireFeature("query_log");
        const entries = auditLog.getRecent(limit ?? 20);
        if (entries.length === 0) return { content: [{ type: "text", text: "No queries logged yet." }] };
        const lines = entries.map(e =>
          `[${e.timestamp}] ${e.blocked ? "❌ BLOCKED" : "✅"} ${e.connection} | ${e.execution_time_ms}ms | ${e.rows_returned} rows\n  ${e.sql.substring(0, 120)}`
        );
        return { content: [{ type: "text", text: `Recent queries (${entries.length}):\n\n${lines.join("\n\n")}` }] };
      } catch (e) { return formatError(e); }
    }
  );

  // Cleanup
  const cleanup = async () => { logger.info("Shutting down..."); await connManager.closeAll(); };
  process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
  process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });

  return server;
}
