# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-05-04

### Added

- **4-layer SQL security defense** — AST parsing, multi-statement blocking, dangerous function blacklist, transaction isolation
- **3 security modes** — `readonly`, `restricted`, `unrestricted`
- **8 MCP tools** — `list_connections`, `use_connection`, `get_schema`, `query`, `next_page`, `explain_query`, `suggest_indexes`, `query_log`
- **Multi-database support** — named connections with independent security modes
- **Result pagination** — auto-paginated at 50 rows per page
- **Field truncation** — long text fields auto-truncated at 500 characters
- **Schema introspection** — tables, columns, indexes, foreign keys, comments, row estimates
- **Structured JSON logging** — configurable log levels via `SAFEDB_LOG_LEVEL`
- **SSL / RDS / Azure support** — full TLS configuration
- **Pro features** — EXPLAIN analysis, slow query detection, index recommendations, query audit log
- **Client configuration guides** — Claude Code, Cursor, VS Code, Windsurf, Claude Desktop
