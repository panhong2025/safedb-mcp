---
name: Bug Report
about: Report a bug to help us improve SafeDB MCP
title: "[Bug] "
labels: bug
assignees: ''
---

## Environment

- **SafeDB MCP version:** (e.g., 1.1.0)
- **Node.js version:** (run `node --version`)
- **OS:** (e.g., macOS 14.5, Ubuntu 22.04, Windows 11)
- **MCP Client:** (e.g., Claude Code, Cursor, VS Code Copilot, Claude Desktop)
- **PostgreSQL version:** (if relevant)

## Description

A clear and concise description of the bug.

## Steps to Reproduce

1. Configure SafeDB with `...`
2. Send query `...`
3. See error

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include error messages or logs if available.

## Logs

<details>
<summary>SafeDB logs (if available)</summary>

```
Paste logs here. Set SAFEDB_LOG_LEVEL=debug for verbose output.
```

</details>

## Configuration

<details>
<summary>safedb.config.json (remove sensitive info)</summary>

```json
{
  "connections": {
    "default": {
      "type": "postgresql",
      "url": "postgresql://***@***/mydb",
      "mode": "readonly"
    }
  }
}
```

</details>

## Additional Context

Add any other context about the problem here (screenshots, related issues, etc.).
