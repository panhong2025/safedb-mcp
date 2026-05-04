# 官方 Anthropic Postgres MCP Server 存在 SQL 注入漏洞 -- SafeDB 是如何做到 4 层防御的

> 当你把数据库交给 AI Agent，你确定它不会执行 `DROP SCHEMA public CASCADE` 吗？

## 背景：MCP 正在让 AI 直连数据库

Model Context Protocol（MCP）正在成为 AI Agent 访问外部工具的标准协议。其中最常见的场景之一，就是让 LLM 直接查询数据库 -- 用自然语言提问，AI 生成 SQL，MCP Server 执行并返回结果。

听起来很美好，但这里有一个致命问题：**AI 生成的 SQL 是不可信的。**

LLM 可能被 prompt injection 操纵，生成恶意 SQL；也可能因为"幻觉"拼出危险语句。如果 MCP Server 没有做好 SQL 安全校验，数据库就是裸奔状态。

2025 年，Datadog Security Labs 发布了一份报告，详细分析了 Anthropic 官方 Postgres MCP Server 中的 SQL 注入漏洞。这个漏洞影响了每周 21,000 次下载量的 `@modelcontextprotocol/server-postgres` 包，直到该包被废弃都未在 NPM 上修复。

本文将深入分析这个漏洞的攻击原理，并展示 SafeDB MCP 是如何通过 4 层纵深防御来彻底解决这类问题的。

## 漏洞分析：官方 MCP Server 到底错在哪里

### 它以为的安全措施

官方 Postgres MCP Server 的防御思路很简单：把用户的 SQL 包裹在只读事务中。

```sql
BEGIN TRANSACTION READ ONLY;
-- 用户的 SQL 在这里执行
COMMIT;
```

看起来合理 -- 只读事务不能写入数据。但问题在于：**它允许一次执行多条 SQL 语句。**

### 一行代码击穿防线

攻击者（或被 prompt injection 操纵的 AI）只需要构造这样的输入：

```sql
COMMIT; DROP SCHEMA public CASCADE;
```

执行流程变成了：

```sql
BEGIN TRANSACTION READ ONLY;
COMMIT;                          -- 结束只读事务
DROP SCHEMA public CASCADE;      -- 删除整个 public schema
COMMIT;                          -- 原本的结束语句
```

第一个 `COMMIT` 提前结束了只读事务的保护，后面的 `DROP` 语句就在无保护的上下文中执行了。整个数据库的表、视图、函数 -- 全部被删除。

### 更隐蔽的攻击方式

除了直接破坏数据，攻击者还可以做更隐蔽的事情：

```sql
-- 篡改会话参数，让后续所有查询超时
COMMIT; SET statement_timeout TO 1;

-- 读取服务器文件
COMMIT; SELECT pg_read_file('/etc/passwd');

-- 通过 COPY 导出数据到文件
COMMIT; COPY users TO '/tmp/dump.csv';
```

这些攻击不会触发明显的错误，但后果同样严重。

**来源**：Datadog Security Labs,《MCP Vulnerability Case Study: SQL Injection in the PostgreSQL MCP Server》[1]

## SafeDB MCP 的 4 层纵深防御

SafeDB MCP 的核心设计理念是**纵深防御（Defense in Depth）** -- 不依赖单一机制，而是用 4 层独立的安全检查，每一层都能独立拦截攻击。

### 第 1 层：多语句拦截

这是针对官方漏洞的直接防御。SafeDB 在执行任何 SQL 之前，先检测是否包含多条语句。

```typescript
function containsMultipleStatements(sql: string): boolean {
  // 先清除字符串字面量和注释，避免误判
  const cleaned = sql
    .replace(/'[^']*'/g, "''")           // 移除单引号字符串
    .replace(/"[^"]*"/g, '""')           // 移除双引号标识符
    .replace(/--[^\n]*/g, "")            // 移除单行注释
    .replace(/\/\*[\s\S]*?\*\//g, "");   // 移除多行注释

  // 检查是否存在非末尾的分号
  const trimmed = cleaned.trim();
  const withoutTrailing = trimmed.endsWith(";")
    ? trimmed.slice(0, -1).trim()
    : trimmed;

  return withoutTrailing.includes(";");
}
```

官方漏洞的核心攻击手段 `COMMIT; DROP SCHEMA public CASCADE` 在这一层就会被直接拦截，返回：

```
"Multiple statements detected. SafeDB only allows single statements for security."
```

注意：代码会先清除字符串和注释内容，所以 `SELECT * FROM t WHERE name = 'a;b'` 这样的合法查询不会被误判。

### 第 2 层：危险 Pattern 正则检测

即使是单条 SQL，也可能包含危险操作。SafeDB 用正则表达式检测已知的危险模式：

```typescript
const DANGEROUS_PATTERNS = [
  /\bCOPY\b.*\bTO\b/i,              // PostgreSQL 文件导出
  /\bSELECT\b.*\bINTO\s+OUTFILE\b/i, // MySQL 文件导出
  /\bSELECT\b.*\bINTO\s+DUMPFILE\b/i,
  /\bLOAD_FILE\s*\(/i,              // MySQL 文件读取
  /\bBENCHMARK\s*\(/i,              // 时间盲注常用函数
];
```

当攻击者尝试 `COPY users TO '/tmp/dump.csv'` 时，即使它是单条合法 SQL，也会在第 2 层被拦截。

### 第 3 层：AST 解析 + 语句类型白名单

这是最核心的一层防御。SafeDB 使用 SQL 解析器将语句解析为抽象语法树（AST），然后根据当前安全模式检查语句类型是否在白名单中。

```typescript
const MODE_WHITELIST: Record<ConnectionMode, Set<string>> = {
  readonly:    new Set(["select", "show", "desc", "describe", "explain"]),
  restricted:  new Set(["select", "show", "desc", "describe", "explain",
                         "insert", "update", "delete"]),
  unrestricted: new Set(["*"]),
};

// 解析 SQL 为 AST
const ast = parser.astify(trimmed, { database: "PostgreSQL" });
const statementType = ast.type.toLowerCase();

// 检查是否在白名单中
if (!whitelist.has("*") && !whitelist.has(statementType)) {
  throw new QueryBlockedError(
    `Statement type '${statementType.toUpperCase()}' is not allowed in ${mode} mode.`
  );
}
```

三种安全模式的权限对比：

| 模式 | 允许的操作 | 适用场景 |
|------|-----------|---------|
| `readonly`（默认） | SELECT, SHOW, EXPLAIN | 生产环境数据查询 |
| `restricted` | + INSERT, UPDATE, DELETE | 需要写入的应用 |
| `unrestricted` | 除危险函数外全部允许 | 仅限本地开发环境 |

在默认的 `readonly` 模式下，`DROP TABLE`、`CREATE TABLE`、`ALTER TABLE`、`TRUNCATE` 等 DDL 操作全部会被拦截，无论攻击者如何构造 SQL。

关键设计：**Fail-close 策略** -- 如果 SQL 解析器无法解析某条语句（语法异常、使用了解析器不支持的特性），SafeDB 会直接拒绝执行，而不是放行。这意味着攻击者无法通过构造畸形 SQL 来绕过解析。

```typescript
try {
  const ast = parser.astify(trimmed, { database: "PostgreSQL" });
  // ...
} catch (e) {
  // 解析失败 = 直接拒绝
  throw new QueryBlockedError(
    "Could not parse SQL statement. For security, unparseable queries are blocked."
  );
}
```

### 第 4 层：危险函数黑名单

即使在 `unrestricted` 模式下，以下函数也会被永久禁止：

```typescript
const DANGEROUS_FUNCTIONS = new Set([
  "pg_read_file",          // 读取服务器文件
  "pg_read_binary_file",   // 读取二进制文件
  "pg_write_file",         // 写入服务器文件
  "lo_import",             // 导入大对象
  "lo_export",             // 导出大对象到文件
  "pg_sleep",              // 资源耗尽攻击
  "dblink",                // 连接外部数据库
  "dblink_exec",           // 在外部数据库执行命令
]);
```

这些函数的共同特点是：它们可以突破数据库边界，访问文件系统或外部网络。即使你信任 AI 的 SQL 生成能力，也不应该让它有能力读取 `/etc/passwd` 或连接到外部数据库。

## 实际拦截效果

以下是 SafeDB 面对各种攻击时的实际表现：

| 攻击输入 | 拦截层 | SafeDB 的响应 |
|----------|--------|--------------|
| `COMMIT; DROP SCHEMA public CASCADE` | 第 1 层 | "Multiple statements detected" |
| `COPY users TO '/tmp/dump.csv'` | 第 2 层 | "Dangerous SQL pattern detected" |
| `DROP TABLE users` | 第 3 层 | "Statement type 'DROP' is not allowed in readonly mode" |
| `SELECT pg_read_file('/etc/passwd')` | 第 4 层 | "Dangerous function 'pg_read_file' is not allowed" |
| `S\x00ELECT * FROM users` | 第 3 层 | "Could not parse SQL statement" (Fail-close) |

每一层都是独立的检查点。即使某一层被绕过（比如发现了新的正则绕过方式），后面的层仍然会拦截攻击。这就是纵深防御的价值。

## 为什么官方方案不够

回过头来看，官方 Postgres MCP Server 的问题本质上是**只有一层防御** -- 依赖 `READ ONLY` 事务。一旦这层被绕过（通过多语句注入 `COMMIT`），就完全没有后续检查。

对比一下两者的防御架构：

```
官方 MCP Server:
  用户 SQL --> BEGIN READ ONLY --> 执行 --> COMMIT
              ^^ 唯一的防线，一旦绕过就全线崩溃

SafeDB MCP:
  用户 SQL --> 多语句检测 --> 危险 Pattern --> AST 解析 + 白名单 --> 危险函数检查 --> 执行
              ^^第1层^^     ^^第2层^^      ^^第3层^^            ^^第4层^^
```

## 结语

MCP 让 AI 获得了直接操作数据库的能力，这是效率的巨大提升，但也把 SQL 注入这个"古老"的安全问题带到了新的战场。当 SQL 的生成者从人类程序员变成了可能被操纵的 LLM，传统的"信任输入"假设就不再成立。

SafeDB MCP 的设计出发点很简单：**不信任任何输入的 SQL，用 4 层独立检查确保安全。** 默认 readonly 模式 + fail-close 策略，让安全成为开箱即用的默认状态，而不是需要额外配置的选项。

项目完全开源，欢迎试用和反馈：

- GitHub: [https://github.com/panhong2025/safedb-mcp](https://github.com/panhong2025/safedb-mcp)
- 安装：`npx safedb-mcp`
- 默认即安全，零配置启动，开箱即用

---

**参考资料**

[1] Datadog Security Labs. "MCP Vulnerability Case Study: SQL Injection in the PostgreSQL MCP Server." [https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/](https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/)
