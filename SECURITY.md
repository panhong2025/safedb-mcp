# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in SafeDB MCP, **please do not open a public issue.**

Instead, report it privately via email:

**Email:** panhong2025@gmail.com

**Subject line:** `[SECURITY] SafeDB MCP — <brief description>`

**Include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

## Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within **48 hours** |
| Initial assessment | Within **5 business days** |
| Fix release (critical) | Within **7 days** |
| Fix release (moderate) | Within **30 days** |

## Security Update Policy

- Critical vulnerabilities are patched immediately and published as a new npm version
- Security fixes are documented in [CHANGELOG.md](./CHANGELOG.md) with a `[SECURITY]` prefix
- Users are notified via GitHub Security Advisories

## Security Design

SafeDB MCP uses a **4-layer defense** system to protect your databases:

### 1. Multi-Statement Blocking
All semicolon-separated queries are rejected before parsing. This prevents the primary SQL injection vector that affected the official Anthropic Postgres MCP server ([Datadog CVE case study](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/)).

### 2. AST Parsing + Type Checking
Every SQL statement is parsed into an Abstract Syntax Tree using `node-sql-parser`. The statement type (SELECT, INSERT, DROP, etc.) is validated against the current security mode's whitelist. **Fail-close policy:** if a query cannot be parsed, it is rejected.

### 3. Dangerous Function Blacklist
Functions that can read/write files or access external systems are always blocked, regardless of security mode:
- `pg_read_file`, `pg_write_file`
- `lo_import`, `lo_export`
- `pg_sleep`
- `dblink`
- `COPY TO` file exports

### 4. Transaction Isolation
Read-only queries are executed inside `BEGIN TRANSACTION READ ONLY` with `statement_timeout` enforced via `set_config()` (parameterized, injection-safe).

## Error Sanitization

All error messages returned to clients are sanitized to remove:
- Database connection strings
- Passwords and hostnames
- Internal file paths and stack traces

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | Yes      |
| < 1.0   | No       |

## Acknowledgments

We appreciate security researchers who help keep SafeDB MCP safe. Contributors who report valid vulnerabilities will be credited in our CHANGELOG (with permission).
