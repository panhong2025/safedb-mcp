# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-05-04

### Added

- **Test coverage 30% → 89 tests** — New test suites for license manager, config loader, connection manager, query engine
- **Test fixtures** — `license-keys.json` (7 license key scenarios), `configs.json` (8 config validation scenarios)
- **CONTRIBUTING.md** — Development setup, code conventions, PR workflow, commit message format
- **SECURITY.md** — Vulnerability reporting process, response timeline, security design overview
- **GitHub Issue templates** — Bug report and feature request templates (`.github/ISSUE_TEMPLATE/`)
- **ESLint flat config** — `eslint.config.js` with `typescript-eslint` recommended rules
- **Prettier config** — `.prettierrc.json` with project formatting standards
- **Pro purchase link** — Gumroad purchase page linked in both README files
- **Community section** — GitHub Discussions, Contributing, Security links in both READMEs
- **English security article** — `docs/article-security-analysis-en.md` for international promotion

### Changed

- `npm run lint` now runs ESLint instead of `tsc --noEmit` (type checking moved to `npm run typecheck`)
- Added `format`, `format:check`, `typecheck` scripts to package.json
- Updated devDependencies: added `eslint`, `prettier`, `typescript-eslint`
- ProRequiredError now shows actual Gumroad purchase URL instead of placeholder

### Deferred

- **Ed25519 license signing** (SEC-03 from v1.0 QA) — deferred to v1.2. Current Base64 encoding is acceptable for MVP since Pro features are convenience-only, not security-critical.

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
