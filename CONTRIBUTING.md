# Contributing to SafeDB MCP

Thank you for your interest in contributing! SafeDB MCP is a security-first database MCP server, and we welcome contributions that improve security, reliability, and developer experience.

## Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/safedb-mcp.git
cd safedb-mcp

# 2. Install dependencies
npm install

# 3. Run in development mode (hot reload)
npm run dev

# 4. Run tests
npm test

# 5. Build
npm run build
```

**Requirements:** Node.js >= 20.0.0

## Code Conventions

- **Language:** TypeScript with `strict` mode enabled
- **Module system:** ES Modules (`"type": "module"`)
- **Logging:** Use the shared `logger` from `src/utils/logger.ts` — do not use `console.log`
- **Error handling:** Use custom error classes from `src/utils/errors.ts` — never expose raw database errors to clients
- **Naming:** camelCase for variables/functions, PascalCase for classes/types
- **Formatting:** Run `npm run format` before committing (Prettier)
- **Linting:** Run `npm run lint` to check for issues (ESLint + TypeScript)

## Pull Request Workflow

1. **Fork** the repository and create a feature branch from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** — keep PRs focused on a single concern.

3. **Write tests** — all new features and bug fixes must include tests.
   ```bash
   npm test          # Run all tests
   npm run test:watch  # Watch mode during development
   ```

4. **Ensure everything passes:**
   ```bash
   npm test        # All tests pass
   npm run build   # TypeScript compiles without errors
   npm run lint    # No lint errors
   ```

5. **Push and open a PR** against the `dev` branch:
   ```bash
   git push origin feat/your-feature-name
   ```
   Then open a Pull Request on GitHub targeting the `dev` branch.

## Test Requirements

- New features must include unit tests
- Bug fixes should include a regression test
- Tests use [Vitest](https://vitest.dev/) — see `tests/` for existing patterns
- Mock external dependencies (pg, fs) — do not require a running database
- Run `npm test` and ensure all tests pass before submitting

## Commit Message Convention

Use clear, descriptive commit messages:

```
feat: add PII masking for email columns
fix: handle SSL connection timeout on Azure
test: add edge cases for multi-statement detection
docs: update configuration reference
chore: upgrade vitest to v3.2
```

**Prefix format:**
- `feat:` — new feature
- `fix:` — bug fix
- `test:` — adding or updating tests
- `docs:` — documentation changes
- `chore:` — dependencies, CI, tooling
- `refactor:` — code changes that don't fix bugs or add features
- `security:` — security-related changes

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── server.ts             # MCP server + tool definitions
├── auth/license.ts       # Pro license management
├── config/
│   ├── loader.ts         # Config file loading + env var resolution
│   └── schema.ts         # Zod validation schemas
├── core/
│   ├── conn-manager.ts   # Connection pool management
│   ├── guard.ts          # 4-layer SQL security validation
│   ├── query-engine.ts   # Query execution pipeline
│   ├── pager.ts          # Result pagination + truncation
│   └── schema-reader.ts  # Database schema introspection
├── tools/query-log.ts    # Pro audit log
└── utils/
    ├── errors.ts         # Custom error classes
    └── logger.ts         # Structured JSON logger
```

## Security

If you discover a security vulnerability, **do not open a public issue**. Please see [SECURITY.md](./SECURITY.md) for responsible disclosure instructions.

## Questions?

Open a [Discussion](https://github.com/panhong2025/safedb-mcp/discussions) on GitHub — we're happy to help!
