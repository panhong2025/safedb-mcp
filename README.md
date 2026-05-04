# SafeDB MCP

[English](./README.md) | [中文](./README.zh-CN.md)

**Security-first database MCP server.** Let AI safely query and manage your PostgreSQL databases.

> The official Anthropic Postgres MCP server has an [unpatched SQL injection vulnerability](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/) and was archived in May 2025. SafeDB is built from scratch with security as the #1 priority.

## Why SafeDB?

| Feature | Official (deprecated) | crystaldba | **SafeDB** |
|---------|----------------------|------------|------------|
| SQL injection protection | No (CVE) | Partial | **4-layer defense** |
| Multi-statement blocking | No | No | **Yes** |
| Result pagination | No | No | **Auto (50 rows/page)** |
| Multiple databases | No | No | **Yes (named connections)** |
| Schema with comments | No | Partial | **Full (tables + columns)** |
| Field truncation | No | No | **Auto (500 chars)** |
| Security modes | Read-only only | Unrestricted default | **readonly / restricted / unrestricted** |
| SSL / RDS / Azure | Buggy | Partial | **Full support** |

## Quick Start

```bash
# 1. Set your database connection
export DATABASE_URL="postgresql://user:password@localhost:5432/mydb"

# 2. Add to your MCP client config (Claude Code example)
# Add the following to .mcp.json in your project root:
```

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

```bash
# 3. Restart your client and ask AI: "What tables are in the database?"
# SafeDB will securely return the schema. That's it.
```

## Use Cases

### Explore Schema

> **You:** "What tables are in the database? What columns does the users table have?"
>
> **AI** calls `get_schema` → returns all table names, column types, comments, and row estimates
>
> ```
> Tables (5):
>   users        — 12,847 rows
>   orders       — 89,231 rows
>   products     — 1,024 rows
>   payments     — 67,892 rows
>   audit_logs   — 245,001 rows
> ```

Great for: onboarding onto a new project, understanding data models.

---

### Query Data with Natural Language

> **You:** "How many users signed up in the last 7 days? Break it down by day."
>
> **AI** calls `query` → generates and executes safe SQL
>
> ```sql
> SELECT DATE(created_at) AS day, COUNT(*) AS new_users
> FROM users
> WHERE created_at >= NOW() - INTERVAL '7 days'
> GROUP BY DATE(created_at)
> ORDER BY day;
> ```
>
> ```
> day         | new_users
> 2026-04-28  | 142
> 2026-04-29  | 156
> 2026-04-30  | 198
> ...
> ```

Great for: daily metrics, ad-hoc analytics, quick hypothesis validation.

---

### AI-Assisted Debugging

> **You:** "User #8821 says they paid but their order still shows as unpaid. Can you check?"
>
> **AI** calls `query` on orders, payments, and audit_logs tables
>
> ```
> Findings:
> - orders: order #45231, status = 'unpaid', amount = 99.00
> - payments: payment #78923, order_id = 45231, status = 'success', paid_at = 2026-04-30 14:23:01
> - Conclusion: Payment succeeded but order status was not updated.
>   Likely a webhook callback failure. Check the payment webhook handler.
> ```

Great for: production debugging, support escalations, cross-table consistency checks.

---

### Security Guardrails

> **You:** "Drop the users table."
>
> **AI** calls `query("DROP TABLE users")`
>
> ```
> ❌ Blocked by SafeDB:
> "Statement type 'DROP' is not allowed in readonly mode.
>  Current mode: readonly. Allowed: SELECT, SHOW, EXPLAIN."
> ```

> **You:** "Run `SELECT * FROM users; DELETE FROM users`"
>
> ```
> ❌ Blocked by SafeDB:
> "Multiple statements detected. Multi-statement queries are always blocked
>  to prevent SQL injection attacks."
> ```

This is SafeDB's key differentiator — the official MCP server was compromised by exactly this type of SQL injection attack.

---

### Multi-Database Switching

> **You:** "Switch to the prod database and check today's order count."
>
> **AI** calls `use_connection("prod")` → `query(...)`
>
> ```
> ✅ Switched to 'prod' (readonly mode)
> Today's orders: 1,247 | Revenue: $18,643
> ```

Great for: multi-environment management, comparing dev vs. prod data.

## Client Configuration

### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in your project root.

> **Note:** VS Code uses `servers` as the root key, not `mcpServers`.

```json
{
  "servers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### Claude Desktop

Edit `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/`
- Windows: `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

## Multiple Databases

Create a `safedb.config.json` to configure separate connections with independent security modes:

```json
{
  "connections": {
    "dev": {
      "type": "postgresql",
      "url": "${DEV_DATABASE_URL}",
      "mode": "unrestricted"
    },
    "staging": {
      "type": "postgresql",
      "url": "${STAGING_DATABASE_URL}",
      "mode": "restricted"
    },
    "prod": {
      "type": "postgresql",
      "url": "${PROD_DATABASE_URL}",
      "mode": "readonly",
      "ssl": true
    }
  }
}
```

Then point your MCP client config to the file:

```json
{
  "mcpServers": {
    "safedb": {
      "command": "npx",
      "args": ["-y", "safedb-mcp", "--config", "./safedb.config.json"]
    }
  }
}
```

## Tools

| Tool | Description | Free |
|------|-------------|------|
| `list_connections` | List all database connections | Yes |
| `use_connection` | Switch active database | Yes |
| `get_schema` | Get table structure, comments, indexes, foreign keys | Yes |
| `query` | Execute SQL with security validation + auto pagination | Yes |
| `next_page` | Get next page of query results | Yes |
| `explain_query` | Analyze query execution plan | Pro |
| `suggest_indexes` | Find slow queries and suggest indexes | Pro |
| `query_log` | View query history with execution times | Pro |

## Security Model

SafeDB uses a **4-layer defense** system:

1. **AST Parsing** — Every SQL statement is parsed into an Abstract Syntax Tree. Statement type is checked against the current mode's whitelist.
2. **Multi-statement Blocking** — Semicolon-separated queries are always rejected. This blocks the exact attack that affected the official server.
3. **Dangerous Function Blacklist** — `pg_read_file`, `lo_export`, `COPY TO`, `pg_sleep`, `dblink` and others are always blocked.
4. **Transaction Isolation** — Read-only queries run inside `BEGIN TRANSACTION READ ONLY` with `statement_timeout`.

**Fail-close policy:** If a SQL statement cannot be parsed, it is rejected. We prefer false negatives over security holes.

### Security Modes

| Mode | Allowed | Use case |
|------|---------|----------|
| `readonly` (default) | SELECT, SHOW, EXPLAIN | Production databases |
| `restricted` | + INSERT, UPDATE, DELETE | Staging / development |
| `unrestricted` | Everything except dangerous functions | Local development only |

## Pro ($19/month)

- EXPLAIN query analysis with performance suggestions
- Slow query detection via pg_stat_statements
- Index recommendations
- Query audit log
- PII auto-masking (coming soon)

## Configuration Reference

Environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (simple mode) |
| `SAFEDB_MODE` | Default mode: `readonly` / `restricted` / `unrestricted` |
| `SAFEDB_LICENSE_KEY` | Pro license key |
| `SAFEDB_LOG_LEVEL` | Log level: `debug` / `info` / `warn` / `error` |

## Troubleshooting

### MCP server won't start

```
Error: MCP server failed to start
```

1. Check Node.js version >= 20: `node --version`
2. Check npx is available: `npx --version`
3. Try installing globally: `npm install -g safedb-mcp`, then set `command` to `safedb-mcp` and `args` to `[]`

### Database connection timeout

```
Error: Connection terminated due to connection timeout
```

1. Verify the database host and port are reachable: `pg_isready -h localhost -p 5432`
2. Check firewall / security group rules for the port
3. For cloud databases (RDS / Azure), make sure your IP is whitelisted

### SSL certificate errors

```
Error: self-signed certificate / SSL connection required
```

Enable SSL and allow self-signed certificates in your connection config:

```json
{
  "connections": {
    "prod": {
      "type": "postgresql",
      "url": "${PROD_DATABASE_URL}",
      "ssl": true,
      "sslRejectUnauthorized": false
    }
  }
}
```

> **Warning:** Only use `sslRejectUnauthorized: false` in development. Use a proper CA certificate in production.

### AI client can't see SafeDB tools

1. Validate your config file is valid JSON (use `jsonlint` or your editor)
2. Restart your AI client (most clients don't hot-reload MCP configs)
3. VS Code users: the root key must be `servers`, not `mcpServers`

## License

MIT
