# SafeDB MCP — npm 注册与发布指南

> 一人公司场景下，从零到 npm publish 的完整操作手册。
> 适用于首次发布和后续版本迭代。

---

## 一、前置准备（仅首次）

### 1.1 注册 npm 账号

1. 打开 https://www.npmjs.com/signup
2. 填写 Username、Email、Password
3. 进入邮箱点击验证链接完成注册

### 1.2 本地登录 npm

```bash
npm login
```

按提示输入：
- Username
- Password
- Email
- OTP（如果开启了 2FA，会发到邮箱或 Authenticator App）

验证登录状态：

```bash
npm whoami
# 应该输出你的用户名，如 panhong2025
```

### 1.3 检查包名是否可用

```bash
npm view safedb-mcp
# 如果返回 404 / "Not Found"，说明包名可用
# 如果返回包信息，说明已被占用，需要换名
```

> **建议：** 发布前先在 https://www.npmjs.com/package/safedb-mcp 搜索确认。

---

## 二、项目配置（package.json 关键字段）

以下字段直接影响 npm 发布：

```json
{
  "name": "safedb-mcp",              // npm 包名（全局唯一）
  "version": "1.1.0",                // 语义化版本号
  "description": "Security-first...", // npm 搜索页显示的描述
  "keywords": ["mcp", "database"...], // npm 搜索关键词
  "license": "MIT",                   // 开源协议
  "author": "SafeDB",                // 作者信息

  "main": "dist/index.js",           // 包的入口文件
  "bin": {
    "safedb-mcp": "dist/index.js"    // CLI 命令名 → 入口文件
  },
  "files": [                         // npm publish 时包含的文件
    "dist",                          //   编译后的 JS
    "README.md",                     //   npm 包页面显示的文档
    "LICENSE"                        //   开源协议文件
  ],

  "scripts": {
    "build": "tsc",                  // TypeScript 编译
    "prepublishOnly": "npm run build" // 发布前自动编译（安全钩子）
  },

  "repository": {                    // npm 页面显示的仓库链接
    "type": "git",
    "url": "git+https://github.com/panhong2025/safedb-mcp.git"
  },
  "homepage": "https://github.com/panhong2025/safedb-mcp#readme",
  "bugs": {
    "url": "https://github.com/panhong2025/safedb-mcp/issues"
  },

  "engines": {
    "node": ">=20.0.0"               // 最低 Node.js 版本要求
  }
}
```

### 关键说明

| 字段 | 作用 | 注意事项 |
|------|------|---------|
| `name` | npm 包名 | 全小写、可用连字符、全局唯一 |
| `version` | 版本号 | 遵循 semver，每次 publish 必须递增 |
| `files` | 发布白名单 | 只包含用户需要的文件，不要发布源码和测试 |
| `bin` | CLI 命令 | 让用户可以 `npx safedb-mcp` 直接运行 |
| `prepublishOnly` | 发布前钩子 | 自动编译，防止发布未编译的代码 |

### 不会被发布的文件

以下文件/目录默认被 npm 排除，或因为不在 `files` 白名单中而不会发布：
- `src/` — TypeScript 源码
- `tests/` — 测试文件
- `node_modules/` — 依赖（npm install 时自动下载）
- `.github/` — Issue 模板等
- `docs/` — 项目文档
- `tsconfig.json`、`eslint.config.js`、`.prettierrc.json` — 开发配置
- `CONTRIBUTING.md`、`SECURITY.md`、`CHANGELOG.md` — 社区文档

---

## 三、发布前检查清单

每次发布前必须完成：

```bash
# 1. 确认在正确的分支（通常是 main）
git branch
# * main

# 2. 拉取最新代码
git pull origin main

# 3. 运行完整测试
npm test
# ✅ 89 tests passed

# 4. TypeScript 编译检查
npm run build
# ✅ 无错误

# 5. ESLint 检查
npm run lint
# ✅ 0 errors

# 6. 确认版本号已更新
node -e "console.log(require('./package.json').version)"
# 1.1.0

# 7. 确认 CHANGELOG 已更新
head -20 CHANGELOG.md

# 8. 预览将要发布的文件
npm pack --dry-run
# 会列出所有将被打包的文件，确认没有敏感信息
```

---

## 四、发布操作

### 4.1 首次发布

```bash
# 确认已登录
npm whoami

# 发布（prepublishOnly 会自动先执行 npm run build）
npm publish

# 发布成功后验证
npm view safedb-mcp
```

### 4.2 后续版本发布

```bash
# 1. 更新版本号（三选一）
npm version patch   # 1.1.0 → 1.1.1（bug 修复）
npm version minor   # 1.1.0 → 1.2.0（新功能）
npm version major   # 1.1.0 → 2.0.0（破坏性变更）

# 或者手动修改 package.json 中的 version 字段
# 注意：如果手动改，记得同步改 src/server.ts 中的版本号

# 2. 发布
npm publish

# 3. 推送 tag 到 GitHub
git push origin main --tags
```

> **重要：** `npm version` 命令会自动：
> 1. 修改 package.json 的 version
> 2. 创建一个 git commit
> 3. 创建一个 git tag（如 `v1.1.1`）
>
> 但它**不会**修改 `src/server.ts` 中的版本号，需要手动同步。

### 4.3 发布带 OTP 验证

如果 npm 账号开启了 2FA（推荐）：

```bash
npm publish --otp=123456
# 123456 替换为 Authenticator App 或邮件中的一次性验证码
```

---

## 五、发布后验证

```bash
# 1. 在 npm 上查看包信息
npm view safedb-mcp

# 2. 测试安装
npm install -g safedb-mcp
safedb-mcp --help

# 3. 测试 npx 方式（用户最常用的方式）
npx safedb-mcp

# 4. 检查 npm 包页面
# 浏览器打开 https://www.npmjs.com/package/safedb-mcp
# 确认：描述、README 渲染、版本号、发布时间
```

---

## 六、版本迭代流程（完整循环）

```
代码改动 → 测试通过 → 更新版本号 → 更新 CHANGELOG → 提交 → 合入 main → npm publish → 验证
```

详细步骤：

```bash
# 1. 在 dev 分支开发
git checkout dev
# ... 开发、测试 ...

# 2. 全部检查通过
npm test && npm run build && npm run lint

# 3. 更新版本号
# package.json: "version": "1.2.0"
# src/server.ts: version: "1.2.0"

# 4. 更新 CHANGELOG.md
# 添加 ## [1.2.0] - YYYY-MM-DD 章节

# 5. 提交并推送
git add -A
git commit -m "feat: v1.2.0 — ..."
git push origin dev

# 6. 创建 PR 合入 main
gh pr create --base main --head dev --title "Release v1.2.0"

# 7. PR 合入后，切到 main 发布
git checkout main
git pull origin main
npm publish

# 8. 打 tag
git tag v1.2.0
git push origin v1.2.0
```

---

## 七、常见问题

### npm publish 报错 403

```
npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/safedb-mcp
```

**原因：** 包名已被占用，或者未登录。
**解决：**
```bash
npm whoami          # 确认已登录
npm view safedb-mcp # 确认包是你的
```

### npm publish 报错 "Version already exists"

```
npm ERR! 403 You cannot publish over the previously published versions
```

**原因：** 当前 version 号已发布过，npm 不允许覆盖。
**解决：** 递增版本号后重新发布。

### dist 目录不存在

```
npm ERR! prepublishOnly script failed
```

**原因：** `npm run build`（tsc 编译）失败。
**解决：** 先手动运行 `npm run build`，修复 TypeScript 错误后再发布。

### 发布后 npx 运行报错 "Permission denied"

**原因：** `dist/index.js` 缺少执行权限或 shebang 行。
**解决：** 确认 `src/index.ts` 第一行有 `#!/usr/bin/env node`。

### 撤回已发布的版本

```bash
# 72 小时内可以撤回
npm unpublish safedb-mcp@1.1.0

# 或者将某个版本标记为废弃（不删除，但提示用户升级）
npm deprecate safedb-mcp@1.0.0 "Please upgrade to v1.1.0"
```

> **注意：** npm 政策限制，超过 72 小时或被其他包依赖后无法撤回。

---

## 八、安全建议

1. **开启 npm 2FA** — https://www.npmjs.com/settings/~/tfa，防止账号被盗后发布恶意代码
2. **使用 `files` 白名单** — 只发布必要文件，避免泄露 `.env`、配置、测试数据
3. **`npm pack --dry-run`** — 每次发布前预览包内容，确认无敏感信息
4. **`prepublishOnly` 钩子** — 确保每次都是编译后的代码，不发布源码
5. **锁定 `engines`** — 声明最低 Node.js 版本，避免兼容性问题

---

## 九、SafeDB MCP 发布记录

| 版本 | 日期 | 主要变更 | npm 状态 |
|------|------|---------|---------|
| 1.0.0 | 2026-05-04 | 首次发布：4 层安全防御、8 个 MCP 工具、多库支持 | ✅ 已发布 |
| 1.1.0 | 2026-05-04 | 测试覆盖率提升、社区文档、ESLint/Prettier、Pro 购买链路 | ⏳ 待发布 |
