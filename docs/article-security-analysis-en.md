# The Official Anthropic Postgres MCP Server Has a SQL Injection Vulnerability — How SafeDB Implements 4-Layer Defense

> When you give an AI Agent direct access to your database, are you sure it won't execute `DROP SCHEMA public CASCADE`?

## Background: MCP Is Letting AI Connect Directly to Databases

Model Context Protocol (MCP) is becoming the standard for AI agents to access external tools. One of the most common use cases is letting LLMs query databases directly — ask a question in natural language, the AI generates SQL, the MCP server executes it, and returns the results.

Sounds great, but there's a critical problem: **AI-generated SQL is untrusted input.**

LLMs can be manipulated via prompt injection to generate malicious SQL. They can also "hallucinate" dangerous statements. If the MCP server doesn't validate SQL properly, your database is completely exposed.

In 2025, Datadog Security Labs published a detailed analysis of a SQL injection vulnerability in Anthropic's official Postgres MCP server. This vulnerability affected the `@modelcontextprotocol/server-postgres` package (21,000 weekly downloads) and was never patched on npm before the package was archived.

This article analyzes the attack mechanism and demonstrates how SafeDB MCP solves this class of vulnerabilities through 4-layer defense in depth.

## Vulnerability Analysis: What Went Wrong

### The Intended Security Measure

The official Postgres MCP server's defense was simple: wrap user SQL in a read-only transaction.

```sql
BEGIN TRANSACTION READ ONLY;
-- User's SQL executes here
COMMIT;
```

Seems reasonable — read-only transactions can't write data. But the problem: **it allowed executing multiple SQL statements in a single query.**

### One Line to Break Through

An attacker (or a prompt-injected AI) just needs to craft this input:

```sql
COMMIT; DROP SCHEMA public CASCADE;
```

The execution flow becomes:

```sql
BEGIN TRANSACTION READ ONLY;
COMMIT;                          -- Ends the read-only transaction
DROP SCHEMA public CASCADE;      -- Drops the entire public schema
COMMIT;                          -- Original closing statement
```

The first `COMMIT` ends the read-only transaction's protection. The `DROP` statement executes in an unprotected context. Every table, view, and function in the database — gone.

### More Subtle Attacks

Beyond direct destruction, attackers can do more subtle things:

```sql
-- Manipulate session parameters, making all subsequent queries time out
COMMIT; SET statement_timeout TO 1;

-- Read server files
COMMIT; SELECT pg_read_file('/etc/passwd');

-- Export data to files via COPY
COMMIT; COPY users TO '/tmp/dump.csv';
```

These attacks don't trigger obvious errors, but the consequences are equally severe.

**Source:** Datadog Security Labs, "MCP Vulnerability Case Study: SQL Injection in the PostgreSQL MCP Server" [1]

## SafeDB MCP's 4-Layer Defense in Depth

SafeDB MCP's core design principle is **Defense in Depth** — instead of relying on a single mechanism, it uses 4 independent security layers, each capable of stopping attacks on its own.

### Layer 1: Multi-Statement Blocking

This is the direct defense against the official vulnerability. SafeDB checks for multiple statements before executing any SQL.

```typescript
function containsMultipleStatements(sql: string): boolean {
  // Strip string literals and comments to avoid false positives
  const cleaned = sql
    .replace(/'[^']*'/g, "''")           // Remove single-quoted strings
    .replace(/"[^"]*"/g, '""')           // Remove double-quoted identifiers
    .replace(/--[^\n]*/g, "")            // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "");   // Remove multi-line comments

  // Check for non-trailing semicolons
  const trimmed = cleaned.trim();
  const withoutTrailing = trimmed.endsWith(";")
    ? trimmed.slice(0, -1).trim()
    : trimmed;

  return withoutTrailing.includes(";");
}
```

The core attack `COMMIT; DROP SCHEMA public CASCADE` is caught immediately at this layer:

```
"Multiple statements detected. SafeDB only allows single statements for security."
```

Note: The code strips string contents and comments first, so legitimate queries like `SELECT * FROM t WHERE name = 'a;b'` won't be falsely blocked.

### Layer 2: Dangerous Pattern Detection

Even single SQL statements can contain dangerous operations. SafeDB uses regex patterns to detect known dangerous constructs:

```typescript
const DANGEROUS_PATTERNS = [
  /\bCOPY\b.*\bTO\b/i,              // PostgreSQL file export
  /\bSELECT\b.*\bINTO\s+OUTFILE\b/i, // MySQL file export
  /\bSELECT\b.*\bINTO\s+DUMPFILE\b/i,
  /\bLOAD_FILE\s*\(/i,              // MySQL file read
  /\bBENCHMARK\s*\(/i,              // Time-based blind injection
];
```

When an attacker tries `COPY users TO '/tmp/dump.csv'`, even though it's a single valid SQL statement, it gets caught at Layer 2.

### Layer 3: AST Parsing + Statement Type Whitelist

This is the most critical defense layer. SafeDB parses SQL into an Abstract Syntax Tree (AST), then validates the statement type against the current security mode's whitelist.

```typescript
const MODE_WHITELIST: Record<ConnectionMode, Set<string>> = {
  readonly:    new Set(["select", "show", "desc", "describe", "explain"]),
  restricted:  new Set(["select", "show", "desc", "describe", "explain",
                         "insert", "update", "delete"]),
  unrestricted: new Set(["*"]),
};

// Parse SQL into AST
const ast = parser.astify(trimmed, { database: "PostgreSQL" });
const statementType = ast.type.toLowerCase();

// Check against whitelist
if (!whitelist.has("*") && !whitelist.has(statementType)) {
  throw new QueryBlockedError(
    `Statement type '${statementType.toUpperCase()}' is not allowed in ${mode} mode.`
  );
}
```

Security mode comparison:

| Mode | Allowed Operations | Use Case |
|------|-------------------|----------|
| `readonly` (default) | SELECT, SHOW, EXPLAIN | Production data queries |
| `restricted` | + INSERT, UPDATE, DELETE | Applications requiring writes |
| `unrestricted` | Everything except dangerous functions | Local development only |

In the default `readonly` mode, all DDL operations — `DROP TABLE`, `CREATE TABLE`, `ALTER TABLE`, `TRUNCATE` — are blocked regardless of how the SQL is crafted.

**Key design: Fail-close policy** — if the SQL parser cannot parse a statement (abnormal syntax, unsupported features), SafeDB rejects it instead of allowing it through. This means attackers cannot craft malformed SQL to bypass parsing.

```typescript
try {
  const ast = parser.astify(trimmed, { database: "PostgreSQL" });
  // ...
} catch (e) {
  // Parse failure = reject
  throw new QueryBlockedError(
    "Could not parse SQL statement. For security, unparseable queries are blocked."
  );
}
```

### Layer 4: Dangerous Function Blacklist

Even in `unrestricted` mode, these functions are permanently blocked:

```typescript
const DANGEROUS_FUNCTIONS = new Set([
  "pg_read_file",          // Read server files
  "pg_read_binary_file",   // Read binary files
  "pg_write_file",         // Write server files
  "lo_import",             // Import large objects
  "lo_export",             // Export large objects to files
  "pg_sleep",              // Resource exhaustion attack
  "dblink",                // Connect to external databases
  "dblink_exec",           // Execute commands on external databases
]);
```

These functions share a common trait: they can break out of the database boundary to access the filesystem or external network. Even if you trust the AI's SQL generation, you should never let it read `/etc/passwd` or connect to an external database.

## Real-World Blocking Results

Here's how SafeDB handles various attacks in practice:

| Attack Input | Blocking Layer | SafeDB Response |
|-------------|---------------|-----------------|
| `COMMIT; DROP SCHEMA public CASCADE` | Layer 1 | "Multiple statements detected" |
| `COPY users TO '/tmp/dump.csv'` | Layer 2 | "Dangerous SQL pattern detected" |
| `DROP TABLE users` | Layer 3 | "Statement type 'DROP' is not allowed in readonly mode" |
| `SELECT pg_read_file('/etc/passwd')` | Layer 4 | "Dangerous function 'pg_read_file' is not allowed" |
| `S\x00ELECT * FROM users` | Layer 3 | "Could not parse SQL statement" (Fail-close) |

Each layer is an independent checkpoint. Even if one layer is bypassed (e.g., a new regex bypass is discovered), subsequent layers still catch the attack. This is the value of defense in depth.

## Why the Official Solution Falls Short

Looking back, the official Postgres MCP server's problem was fundamentally having **only one layer of defense** — relying on `READ ONLY` transactions. Once that layer was bypassed (via multi-statement injection of `COMMIT`), there were no further checks.

Comparing the two defense architectures:

```
Official MCP Server:
  User SQL --> BEGIN READ ONLY --> Execute --> COMMIT
               ^^ Single defense line, once bypassed everything collapses

SafeDB MCP:
  User SQL --> Multi-statement check --> Dangerous patterns --> AST + Whitelist --> Dangerous functions --> Execute
               ^^ Layer 1 ^^            ^^ Layer 2 ^^         ^^ Layer 3 ^^       ^^ Layer 4 ^^
```

## Conclusion

MCP gives AI the power to directly operate databases — a massive productivity boost, but it also brings the "classic" SQL injection problem to a new battlefield. When the SQL generator changes from a human programmer to a potentially manipulable LLM, the traditional "trust the input" assumption no longer holds.

SafeDB MCP's design philosophy is simple: **trust no SQL input, use 4 independent layers to ensure security.** Default readonly mode + fail-close policy makes security the out-of-the-box default, not an extra configuration option.

The project is fully open source. Try it out and share your feedback:

- GitHub: [https://github.com/panhong2025/safedb-mcp](https://github.com/panhong2025/safedb-mcp)
- Install: `npx safedb-mcp`
- Secure by default, zero-config startup, works out of the box

---

**References**

[1] Datadog Security Labs. "MCP Vulnerability Case Study: SQL Injection in the PostgreSQL MCP Server." [https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/)
