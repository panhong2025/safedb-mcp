import pkg from "node-sql-parser";
const { Parser } = pkg;
import type { ConnectionMode } from "../config/schema.js";
import { QueryBlockedError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const parser = new Parser();

/**
 * Statements allowed per mode.
 * readonly: only SELECT and read-like statements
 * restricted: DML allowed, DDL blocked
 * unrestricted: everything (use only on local dev databases!)
 */
const MODE_WHITELIST: Record<ConnectionMode, Set<string>> = {
  readonly: new Set([
    "select",
    "show",
    "desc",
    "describe",
    "explain",
  ]),
  restricted: new Set([
    "select",
    "show",
    "desc",
    "describe",
    "explain",
    "insert",
    "update",
    "delete",
  ]),
  unrestricted: new Set(["*"]), // allow everything
};

/**
 * Dangerous functions/commands that are ALWAYS blocked, even in unrestricted mode.
 */
const DANGEROUS_FUNCTIONS = new Set([
  "pg_read_file",
  "pg_read_binary_file",
  "pg_write_file",
  "lo_import",
  "lo_export",
  "pg_sleep", // prevent resource exhaustion
  "dblink",
  "dblink_exec",
]);

/**
 * Dangerous clauses in SQL that should be blocked in readonly/restricted modes.
 */
const DANGEROUS_PATTERNS = [
  /\bCOPY\b.*\bTO\b/i,
  /\bSELECT\b.*\bINTO\s+OUTFILE\b/i,
  /\bSELECT\b.*\bINTO\s+DUMPFILE\b/i,
  /\bLOAD_FILE\s*\(/i,
  /\bBENCHMARK\s*\(/i,
];

export interface GuardResult {
  safe: boolean;
  statementType: string;
  isWrite: boolean;
}

/**
 * SQL Security Guard — the core differentiator of SafeDB MCP.
 *
 * Four layers of defense:
 * 1. Multi-statement detection (blocks ; separated queries)
 * 2. AST parsing + statement type whitelist
 * 3. Dangerous function/pattern blacklist
 * 4. Mode-based access control
 */
export function validateSQL(sql: string, mode: ConnectionMode): GuardResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    throw new QueryBlockedError("Empty query", undefined, "Provide a valid SQL statement.");
  }

  // Layer 1: Multi-statement detection
  // This blocks the attack vector: "SELECT 1; DROP TABLE users"
  if (containsMultipleStatements(trimmed)) {
    logger.warn("Blocked: multi-statement query", { sql: trimmed.substring(0, 100), mode });
    throw new QueryBlockedError(
      "Multiple statements detected. SafeDB only allows single statements for security.",
      trimmed.substring(0, 100),
      "Send one SQL statement at a time."
    );
  }

  // Layer 2: Dangerous pattern detection (regex, before AST parsing)
  if (mode !== "unrestricted") {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        logger.warn("Blocked: dangerous SQL pattern", { pattern: pattern.source, sql: trimmed.substring(0, 100), mode });
        throw new QueryBlockedError(
          "Dangerous SQL pattern detected.",
          trimmed.substring(0, 100),
          "This operation is not allowed for security reasons."
        );
      }
    }
  }

  // Layer 3: AST parsing + type check
  let statementType: string;
  try {
    const ast = parser.astify(trimmed, { database: "PostgreSQL" });

    // parser can return an array for multi-statements (double check)
    if (Array.isArray(ast)) {
      if (ast.length > 1) {
        throw new QueryBlockedError(
          "Multiple statements detected in AST.",
          trimmed.substring(0, 100),
          "Send one SQL statement at a time."
        );
      }
      statementType = (ast[0]?.type ?? "unknown").toLowerCase();
    } else {
      statementType = (ast.type ?? "unknown").toLowerCase();
    }
  } catch (e) {
    if (e instanceof QueryBlockedError) throw e;

    // Fail-close: if we can't parse it, we reject it
    logger.warn("SQL parse failed, blocking query", {
      sql: trimmed.substring(0, 100),
      error: e instanceof Error ? e.message : String(e),
    });
    throw new QueryBlockedError(
      "Could not parse SQL statement. For security, unparseable queries are blocked.",
      trimmed.substring(0, 100),
      "Check your SQL syntax. SafeDB uses strict parsing for safety."
    );
  }

  // Layer 4: Mode-based whitelist
  const whitelist = MODE_WHITELIST[mode];
  if (!whitelist.has("*") && !whitelist.has(statementType)) {
    const modeDesc =
      mode === "readonly"
        ? "Only SELECT queries are allowed."
        : "DDL operations (CREATE/DROP/ALTER/TRUNCATE) are not allowed.";

    logger.warn("Blocked: statement type not allowed", { statementType, mode, sql: trimmed.substring(0, 100) });
    throw new QueryBlockedError(
      `Statement type '${statementType.toUpperCase()}' is not allowed in ${mode} mode. ${modeDesc}`,
      trimmed.substring(0, 100),
      mode === "readonly"
        ? "To allow write operations, change the connection mode to 'restricted' in your config file."
        : "To allow DDL operations, change the connection mode to 'unrestricted' (only recommended for local dev)."
    );
  }

  // Check for dangerous functions in the SQL text
  const sqlLower = trimmed.toLowerCase();
  for (const func of DANGEROUS_FUNCTIONS) {
    if (sqlLower.includes(func)) {
      logger.warn("Blocked: dangerous function", { function: func, sql: trimmed.substring(0, 100), mode });
      throw new QueryBlockedError(
        `Dangerous function '${func}' is not allowed.`,
        trimmed.substring(0, 100),
        "This function could compromise database security or stability."
      );
    }
  }

  const isWrite = !["select", "show", "desc", "describe", "explain"].includes(statementType);

  return { safe: true, statementType, isWrite };
}

/**
 * Detect multiple semicolon-separated statements.
 * This is the primary defense against the SQL injection that affected
 * the official Anthropic Postgres MCP server (CVE reported by Datadog).
 */
function containsMultipleStatements(sql: string): boolean {
  // Remove string literals and comments to avoid false positives
  const cleaned = sql
    .replace(/'[^']*'/g, "''")     // remove single-quoted strings
    .replace(/"[^"]*"/g, '""')     // remove double-quoted identifiers
    .replace(/--[^\n]*/g, "")      // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // remove multi-line comments

  // Check for semicolons that aren't at the very end
  const trimmed = cleaned.trim();
  const withoutTrailingSemicolon = trimmed.endsWith(";")
    ? trimmed.slice(0, -1).trim()
    : trimmed;

  return withoutTrailingSemicolon.includes(";");
}
