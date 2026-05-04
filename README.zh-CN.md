# SafeDB MCP

[English](./README.md) | [中文](./README.zh-CN.md)

**安全优先的数据库 MCP 服务。** 让 AI 安全地查询和管理你的 PostgreSQL 数据库。

> 官方 Anthropic Postgres MCP 服务存在一个[未修复的 SQL 注入漏洞](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/)，已于 2025 年 5 月归档。SafeDB 从零构建，安全是第一优先级。

## 为什么选 SafeDB？

| 功能 | 官方（已废弃） | crystaldba | **SafeDB** |
|------|---------------|------------|------------|
| SQL 注入防护 | 无（CVE） | 部分 | **4 层防御** |
| 多语句拦截 | 无 | 无 | **支持** |
| 结果分页 | 无 | 无 | **自动（50 行/页）** |
| 多数据库 | 无 | 无 | **支持（命名连接）** |
| Schema 注释 | 无 | 部分 | **完整（表 + 列）** |
| 字段截断 | 无 | 无 | **自动（500 字符）** |
| 安全模式 | 仅只读 | 默认无限制 | **readonly / restricted / unrestricted** |
| SSL / RDS / Azure | 有 Bug | 部分 | **完整支持** |

## 快速开始

```bash
# 1. 设置数据库连接
export DATABASE_URL="postgresql://user:password@localhost:5432/mydb"

# 2. 添加到 MCP 客户端配置（以 Claude Code 为例）
# 在项目根目录的 .mcp.json 中添加：
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
# 3. 重启客户端，对 AI 说："数据库里有哪些表？"
# SafeDB 会安全地返回表结构。就这么简单。
```

## 使用场景

### 查看表结构

> **你：** "数据库里有哪些表？users 表有哪些字段？"
>
> **AI** 调用 `get_schema` → 返回所有表名、字段类型、注释、行数估算
>
> ```
> Tables (5):
>   users        — 12,847 rows
>   orders       — 89,231 rows
>   products     — 1,024 rows
>   payments     — 67,892 rows
>   audit_logs   — 245,001 rows
> ```

适合：新接手项目、快速了解数据模型、团队 onboarding。

---

### 自然语言查询数据

> **你：** "最近 7 天注册了多少用户？按天统计。"
>
> **AI** 调用 `query` → 自动生成并执行安全 SQL
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

适合：日常数据查询、运营统计、快速验证假设。

---

### AI 辅助 Debug

> **你：** "用户 #8821 说已经付款了但订单还是未支付状态，帮我查一下。"
>
> **AI** 依次查询 orders、payments、audit_logs 三张表
>
> ```
> 排查结果：
> - orders: order #45231, status = 'unpaid', amount = 99.00
> - payments: payment #78923, order_id = 45231, status = 'success', paid_at = 2026-04-30 14:23:01
> - 结论：支付成功但订单状态未同步，可能是回调处理失败。
>   建议检查 payment webhook handler。
> ```

适合：线上问题排查、客服场景、跨表数据一致性检查。

---

### 安全拦截

> **你：** "删掉 users 表。"
>
> **AI** 调用 `query("DROP TABLE users")`
>
> ```
> ❌ SafeDB 拦截：
> "Statement type 'DROP' is not allowed in readonly mode.
>  Current mode: readonly. Allowed: SELECT, SHOW, EXPLAIN."
> ```

> **你：** "执行 `SELECT * FROM users; DELETE FROM users`"
>
> ```
> ❌ SafeDB 拦截：
> "Multiple statements detected. Multi-statement queries are always blocked
>  to prevent SQL injection attacks."
> ```

这是 SafeDB 的核心差异 — 官方 MCP 服务正是因为缺少这层防护才被 SQL 注入攻击。

---

### 多库切换

> **你：** "切到 prod 数据库，查一下今天的订单量。"
>
> **AI** 调用 `use_connection("prod")` → `query(...)`
>
> ```
> ✅ Switched to 'prod' (readonly mode)
> 今日订单：1,247 单 | 营收：¥186,432
> ```

适合：多环境管理、对比 dev 和 prod 数据差异。

## 客户端配置

### Claude Code

在项目根目录创建 `.mcp.json`：

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

编辑 `~/.cursor/mcp.json`：

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

在项目根目录创建 `.vscode/mcp.json`。

> **注意：** VS Code 使用 `servers` 作为根键，不是 `mcpServers`。

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

编辑 `~/.codeium/windsurf/mcp_config.json`：

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

编辑 `claude_desktop_config.json`：
- macOS：`~/Library/Application Support/Claude/`
- Windows：`%APPDATA%\Claude\`

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

## 多数据库配置

创建 `safedb.config.json`，为不同环境设置独立的安全模式：

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

然后在 MCP 客户端配置中指定配置文件：

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

## 工具列表

| 工具 | 说明 | 免费 |
|------|------|------|
| `list_connections` | 列出所有数据库连接 | 是 |
| `use_connection` | 切换当前数据库 | 是 |
| `get_schema` | 获取表结构、注释、索引、外键 | 是 |
| `query` | 执行 SQL（安全校验 + 自动分页） | 是 |
| `next_page` | 获取下一页查询结果 | 是 |
| `explain_query` | 分析查询执行计划 | Pro |
| `suggest_indexes` | 发现慢查询并推荐索引 | Pro |
| `query_log` | 查看查询历史和执行时间 | Pro |

## 安全模型

SafeDB 采用 **4 层防御**体系：

1. **AST 解析** — 每条 SQL 语句都会被解析为抽象语法树，语句类型根据当前模式的白名单进行校验。
2. **多语句拦截** — 分号分隔的多条查询一律拒绝。这正是官方服务被攻击利用的方式。
3. **危险函数黑名单** — `pg_read_file`、`lo_export`、`COPY TO`、`pg_sleep`、`dblink` 等函数始终被禁止。
4. **事务隔离** — 只读查询在 `BEGIN TRANSACTION READ ONLY` 中执行，并设置 `statement_timeout`。

**Fail-close 策略：** 如果 SQL 语句无法被解析，直接拒绝。宁可误拦，不留漏洞。

### 安全模式

| 模式 | 允许的操作 | 适用场景 |
|------|-----------|---------|
| `readonly`（默认） | SELECT, SHOW, EXPLAIN | 生产数据库 |
| `restricted` | + INSERT, UPDATE, DELETE | 预发布 / 开发环境 |
| `unrestricted` | 除危险函数外的所有操作 | 仅限本地开发 |

## Pro 版（$19/月）

- EXPLAIN 查询分析 + 性能优化建议
- 基于 pg_stat_statements 的慢查询检测
- 索引推荐
- 查询审计日志
- PII 自动脱敏（即将上线）

## 配置参考

环境变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串（简单模式） |
| `SAFEDB_MODE` | 默认安全模式：`readonly` / `restricted` / `unrestricted` |
| `SAFEDB_LICENSE_KEY` | Pro 版许可证密钥 |
| `SAFEDB_LOG_LEVEL` | 日志级别：`debug` / `info` / `warn` / `error` |

## 常见问题

### MCP 服务启动失败

```
Error: MCP server failed to start
```

1. 确认 Node.js 版本 >= 20：`node --version`
2. 确认 npx 可用：`npx --version`
3. 尝试全局安装：`npm install -g safedb-mcp`，然后将 `command` 改为 `safedb-mcp`，`args` 设为 `[]`

### 数据库连接超时

```
Error: Connection terminated due to connection timeout
```

1. 确认数据库地址和端口可达：`pg_isready -h localhost -p 5432`
2. 检查防火墙 / 安全组是否放行了该端口
3. 云数据库（RDS / Azure）需确认已将你的 IP 加入白名单

### SSL 证书错误

```
Error: self-signed certificate / SSL connection required
```

在连接配置中启用 SSL 并允许自签名证书：

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

> **注意：** `sslRejectUnauthorized: false` 仅建议在开发环境使用。生产环境请配置正确的 CA 证书。

### AI 客户端看不到 SafeDB 工具

1. 确认配置文件路径和 JSON 格式正确（可用 `jsonlint` 校验）
2. 重启 AI 客户端（大多数客户端不会热加载 MCP 配置）
3. VS Code 用户注意：根键是 `servers`，不是 `mcpServers`

## 许可证

MIT
