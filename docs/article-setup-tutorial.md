# 教程：5 分钟配好 SafeDB MCP，让 AI 安全查数据库

你有没有过这样的场景：线上出了 Bug，需要查数据库定位问题，于是打开终端、连上数据库、手写 SQL、拼错字段名、改了再跑......来回折腾十几分钟，才查到一条关键数据。

现在有另一种方式：直接跟 AI 说"帮我查一下用户 #8821 的订单状态"，AI 自动生成 SQL、执行查询、返回结果。整个过程不到 10 秒。

这就是 MCP（Model Context Protocol）的作用 -- 它是一个开放协议，让 AI 客户端（Claude、Cursor、VS Code Copilot 等）能调用外部工具。而 SafeDB MCP 就是一个专门为数据库设计的 MCP 服务，核心卖点是**安全**：默认只读、SQL 注入防护、危险操作拦截，连到生产库也不怕。

> 背景：Anthropic 官方的 Postgres MCP 服务因为 SQL 注入漏洞已经被废弃归档了。SafeDB 从零构建，用 4 层防御体系解决了这个问题。

## 30 秒安装

前置条件：Node.js >= 20。

不需要单独安装，直接在 AI 客户端的 MCP 配置文件里加一段 JSON 就行。以 Claude Code 为例，在项目根目录创建 `.mcp.json`：

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

把 `DATABASE_URL` 换成你自己的数据库连接字符串，重启客户端，完成。

没有全局安装、没有配置文件生成、没有额外的服务进程。`npx` 会自动下载并运行最新版本。

## 5 个使用场景

配好之后，你可以直接在 AI 对话中操作数据库。以下是 5 个最常见的场景。

### 场景一：查表结构

接手一个新项目，不知道数据库里有什么表、字段是什么含义，以前你需要翻文档或者直接 `\dt` + `\d table_name` 一个个看。现在：

> **你：** 数据库有哪些表？各有多少数据？
>
> **AI** 调用 `get_schema`，返回：
>
> ```
> Tables (5):
>   users        -- 12,847 rows
>   orders       -- 89,231 rows
>   products     -- 1,024 rows
>   payments     -- 67,892 rows
>   audit_logs   -- 245,001 rows
> ```
>
> **你：** users 表的字段结构是什么？
>
> **AI：** users 表包含 id (bigint, 主键), email (varchar, 唯一索引), name (varchar), created_at (timestamp), status (varchar, 默认 'active')......

表名、字段名、类型、注释、索引、外键关系，一次对话全拿到。特别适合新人 onboarding 或者快速熟悉陌生项目。

### 场景二：自然语言查数据

不用写 SQL，直接说人话：

> **你：** 最近 7 天注册了多少用户？按天统计。
>
> **AI** 自动生成并执行：
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
> 2026-05-01  | 312
> 2026-05-02  | 287
> 2026-05-03  | 245
> 2026-05-04  | 173
> ```

日常运营查数据、验证某个假设、给周报拉数字，不再需要等数据分析师排期。

### 场景三：AI 辅助 Debug

这是我个人用得最多的场景。线上问题往往需要跨多张表排查，手动写 JOIN 容易出错，让 AI 来：

> **你：** 用户 #8821 说付了钱但订单显示未支付，帮我查一下怎么回事。
>
> **AI** 依次查询 orders、payments、audit_logs 三张表，返回：
>
> ```
> 排查结果：
> - orders: order #45231, status = 'unpaid', amount = 99.00
> - payments: payment #78923, order_id = 45231, status = 'success',
>   paid_at = 2026-04-30 14:23:01
> - audit_logs: 未找到该订单的状态变更记录
>
> 结论：支付记录显示成功，但订单状态未更新，且审计日志中
> 没有回调记录。大概率是支付回调处理失败。
> 建议检查 payment webhook handler 的日志。
> ```

AI 不只是查数据，它还会分析数据之间的矛盾并给出排查方向。

### 场景四：安全拦截

这是 SafeDB 区别于其他数据库工具的核心能力。AI 有时候会"太听话"，你说删它就真删。SafeDB 不会：

> **你：** 帮我删掉 users 表。
>
> **AI** 调用 `query("DROP TABLE users")`，被 SafeDB 拦截：
>
> ```
> SafeDB 拦截：Statement type 'DROP' is not allowed in readonly mode.
> Current mode: readonly. Allowed: SELECT, SHOW, EXPLAIN.
> ```

即使是多语句注入攻击也会被拦住：

> **你：** 执行 `SELECT 1; DELETE FROM users`
>
> ```
> SafeDB 拦截：Multiple statements detected.
> Multi-statement queries are always blocked to prevent SQL injection.
> ```

默认的 readonly 模式下，只有 SELECT、SHOW、EXPLAIN 能通过。连到生产库完全不用担心误操作。

### 场景五：多库切换

真实开发中你通常有 dev、staging、prod 多套环境，SafeDB 支持在对话中随时切换：

> **你：** 切到 prod 库，查一下今天的订单量。
>
> **AI** 调用 `use_connection("prod")`，然后执行查询：
>
> ```
> 已切换到 prod（readonly 模式）
> 今日订单：1,247 单 | 营收：186,432 元
> ```
>
> **你：** 切回 dev，对比一下测试数据。
>
> **AI** 调用 `use_connection("dev")`：
>
> ```
> 已切换到 dev（unrestricted 模式）
> ```

不同环境可以配不同的安全模式，prod 强制 readonly，dev 放开写入权限。配置方法见下一节。

## 多客户端配置

SafeDB MCP 支持所有主流 AI 客户端。配置方式大同小异，核心区别就是配置文件的路径。

**Claude Code** -- 项目根目录 `.mcp.json`：

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

**Cursor** -- `~/.cursor/mcp.json`，格式同上。

**Windsurf** -- `~/.codeium/windsurf/mcp_config.json`，格式同上。

**Claude Desktop** -- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows: `%APPDATA%\Claude\claude_desktop_config.json`，格式同上。

**VS Code (GitHub Copilot)** -- 项目根目录 `.vscode/mcp.json`，注意根键不同：

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

VS Code 用的是 `servers`，不是 `mcpServers`，这是一个常见的坑，配错了工具列表里不会出现 SafeDB。

## 多数据库配置

单库场景用环境变量 `DATABASE_URL` 就够了。多库场景需要创建配置文件 `safedb.config.json`：

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

然后在 MCP 配置中指向这个文件：

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

连接字符串支持 `${}` 语法引用环境变量，不用把密码明文写在配置文件里。

## 三种安全模式

SafeDB 提供三档安全级别，按环境选择：

| 模式 | 允许的操作 | 适用场景 |
|------|-----------|---------|
| `readonly`（默认） | SELECT, SHOW, EXPLAIN | 生产库，日常查询 |
| `restricted` | 以上 + INSERT, UPDATE, DELETE | 开发环境，预发布环境 |
| `unrestricted` | 除危险函数外全部允许 | 仅限本地开发 |

**readonly** 是默认模式。如果你不做任何配置，连上去就是只读的，SELECT 以外的语句全部拦截。这是刻意的设计 -- 对于大多数场景，你连数据库是为了查数据而不是改数据。

**restricted** 放开了增删改，但仍然禁止 DDL 操作（CREATE、ALTER、DROP 等）。适合需要通过 AI 往开发库写测试数据的场景。

**unrestricted** 放开了几乎所有操作，但仍然封禁 `pg_read_file`、`lo_export`、`COPY TO`、`pg_sleep` 等可能导致文件读写或拒绝服务的危险函数。仅建议在本地开发时使用。

无论哪种模式，多语句查询（用分号分隔的多条 SQL）始终被禁止，这是防 SQL 注入的关键防线。

## 总结

配置只需要 3 步：设置 `DATABASE_URL`，写一段 JSON 配置，重启客户端。之后你就可以用自然语言查数据库、排查 Bug、拉运营数据，不用再手写 SQL。

SafeDB 的安全机制让你可以放心把它连到生产库 -- readonly 模式 + SQL 注入防护 + 危险操作拦截，比你直接用 psql 连上去还安全。

GitHub 地址：[https://github.com/panhong2025/safedb-mcp](https://github.com/panhong2025/safedb-mcp)

如果觉得好用，给个 Star 就是最好的支持。遇到问题可以直接提 Issue。
